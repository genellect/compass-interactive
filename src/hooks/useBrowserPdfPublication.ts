import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { AdminOperationCredentialInput } from '../lib/adminAuth/adminOperationCredential'
import { rememberBrowserPdfExtraction } from '../pdf/adminPdfExtraction'
import { preflightBrowserPdf } from '../pdf/browserPdfPreflight'

type UseBrowserPdfPublicationInput = {
  activeLectureSessionId: string | null
  adminToken: AdminOperationCredentialInput
  browserPublishingEnabled: boolean
  isAuthenticated: boolean
  pdfDisplayName: string
  pdfDownloadEnabled: boolean
  pdfFile: File | null
  onPublicationActivated: (lectureSessionId: string) => void
  requiredDocumentId?: string | null
  refreshAdminPdfDocuments: (
    lectureSessionId?: string,
    token?: AdminOperationCredentialInput,
  ) => Promise<void>
  setPdfDisplayName: Dispatch<SetStateAction<string>>
  setPdfDocumentInput: Dispatch<SetStateAction<string>>
  setPdfFile: Dispatch<SetStateAction<File | null>>
  setPdfPublishing: Dispatch<SetStateAction<boolean>>
  setPublisherMessage: Dispatch<SetStateAction<string>>
}

export function useBrowserPdfPublication({
  activeLectureSessionId,
  adminToken,
  browserPublishingEnabled,
  isAuthenticated,
  pdfDisplayName,
  pdfDownloadEnabled,
  pdfFile,
  onPublicationActivated,
  requiredDocumentId,
  refreshAdminPdfDocuments,
  setPdfDisplayName,
  setPdfDocumentInput,
  setPdfFile,
  setPdfPublishing,
  setPublisherMessage,
}: UseBrowserPdfPublicationInput) {
  const [pdfPublicationDraftId, setPdfPublicationDraftId] = useState('')
  const [pdfPublicationRequestId, setPdfPublicationRequestId] = useState('')
  const [pdfInterruptedPublicationId, setPdfInterruptedPublicationId] =
    useState('')
  const publishInFlightRef = useRef(false)
  const onPublicationActivatedRef = useRef(onPublicationActivated)
  const refreshAdminPdfDocumentsRef = useRef(refreshAdminPdfDocuments)
  onPublicationActivatedRef.current = onPublicationActivated
  refreshAdminPdfDocumentsRef.current = refreshAdminPdfDocuments

  async function publishPdfDocumentInBrowser(
    targetLectureSessionId = activeLectureSessionId,
  ) {
    if (!browserPublishingEnabled) return
    if (!targetLectureSessionId || !adminToken) {
      setPublisherMessage('先に講義を選択してください。')
      return
    }
    if (!pdfFile) {
      setPublisherMessage('公開するPDFを選択してください。')
      return
    }
    if (publishInFlightRef.current) return

    const displayName =
      pdfDisplayName.trim() || pdfFile.name.replace(/\.pdf$/i, '')
    const documentId =
      requiredDocumentId ||
      pdfPublicationDraftId ||
      `doc-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
    if (!pdfPublicationDraftId) setPdfPublicationDraftId(documentId)
    publishInFlightRef.current = true
    setPdfPublishing(true)

    try {
      setPublisherMessage('PDFをブラウザ内で確認しています…')
      const publicationModule =
        await import('../pdf/browserPdfPublicationClient')
      const {
        browserPdfPublicationClient,
        forgetBrowserPdfPublication,
        rememberBrowserPdfPublication,
      } = publicationModule
      const preflight = await preflightBrowserPdf(pdfFile)
      let idempotencyKey = pdfPublicationRequestId
      const adoptInflight = (
        inflight: Awaited<
          ReturnType<typeof browserPdfPublicationClient.discover>
        >,
      ) => {
        if (!inflight) return false
        setPdfInterruptedPublicationId(inflight.publicationId)
        setPdfPublicationDraftId(inflight.documentId)
        setPdfPublicationRequestId(inflight.idempotencyKey)
        rememberBrowserPdfPublication(inflight)
        idempotencyKey = inflight.idempotencyKey
        return inflight.documentId === documentId
      }
      if (!idempotencyKey) {
        const inflight = await browserPdfPublicationClient.discover({
          adminToken,
          lectureSessionId: targetLectureSessionId,
        })
        if (inflight && !adoptInflight(inflight)) {
          setPublisherMessage(
            '前回のPDF公開が残っています。「中断した公開を破棄してやり直す」を押してから再度公開してください。',
          )
          return
        }
      }
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID()
        setPdfPublicationRequestId(idempotencyKey)
      }
      const initiate = () =>
        browserPdfPublicationClient.initiate({
          adminToken,
          displayName,
          documentId,
          downloadEnabled: pdfDownloadEnabled,
          fileName: pdfFile.name,
          idempotencyKey,
          lectureSessionId: targetLectureSessionId,
          preflight,
        })
      setPublisherMessage('安全な公開先を準備しています…')
      let publication
      try {
        publication = await initiate()
      } catch (error) {
        const concurrent = await browserPdfPublicationClient.discover({
          adminToken,
          lectureSessionId: targetLectureSessionId,
        })
        if (!concurrent || !adoptInflight(concurrent)) throw error
        publication = await initiate()
      }
      setPdfInterruptedPublicationId(publication.publicationId)
      rememberBrowserPdfPublication(publication)
      setPublisherMessage('PDFを学生用の非公開領域へ送信しています…')
      if (publication.uploadRequired) {
        await browserPdfPublicationClient.upload(publication, pdfFile)
      }
      setPublisherMessage('講義画面への反映を確定しています…')
      const finalized = await browserPdfPublicationClient.finalize({
        adminToken,
        lectureSessionId: targetLectureSessionId,
        publicationId: publication.publicationId,
      })

      setPdfDocumentInput(finalized.documentId ?? documentId)
      setPdfFile(null)
      setPdfPublicationDraftId(requiredDocumentId ?? '')
      setPdfPublicationRequestId('')
      setPdfDisplayName('')
      if (finalized.status === 'active') {
        rememberBrowserPdfExtraction({
          documentId,
          lectureSessionId: targetLectureSessionId,
          preflight,
        })
        forgetBrowserPdfPublication(targetLectureSessionId)
        setPdfInterruptedPublicationId('')
      }
      await refreshAdminPdfDocuments(targetLectureSessionId, adminToken)
      onPublicationActivatedRef.current(targetLectureSessionId)
      setPublisherMessage(
        `学生への公開が完了しました（${preflight.pageCount}ページ・${(
          preflight.byteSize /
          1024 /
          1024
        ).toFixed(2)}MB）。現在の講義資料として表示しています。`,
      )
    } catch (error) {
      setPublisherMessage(
        error instanceof Error
          ? `資料を公開できませんでした。現在の資料は維持されています: ${error.message}`
          : '資料を公開できませんでした。現在の資料は維持されています。',
      )
    } finally {
      publishInFlightRef.current = false
      setPdfPublishing(false)
    }
  }

  async function abortInterruptedPdfPublication() {
    if (
      !browserPublishingEnabled ||
      !activeLectureSessionId ||
      !adminToken ||
      !pdfInterruptedPublicationId
    ) {
      return
    }
    setPdfPublishing(true)
    setPublisherMessage('中断したPDF公開を安全に破棄しています…')
    try {
      const { browserPdfPublicationClient, forgetBrowserPdfPublication } =
        await import('../pdf/browserPdfPublicationClient')
      await browserPdfPublicationClient.abort({
        adminToken,
        lectureSessionId: activeLectureSessionId,
        publicationId: pdfInterruptedPublicationId,
        reason: 'admin_discarded_inflight',
      })
      forgetBrowserPdfPublication(activeLectureSessionId)
      setPdfInterruptedPublicationId('')
      setPdfPublicationDraftId(requiredDocumentId ?? '')
      setPdfPublicationRequestId('')
      setPublisherMessage(
        '中断した公開を破棄しました。選択中のPDFを新しい公開として開始できます。',
      )
    } catch (error) {
      setPublisherMessage(
        error instanceof Error
          ? `中断したPDF公開を破棄できませんでした: ${error.message}`
          : '中断したPDF公開を破棄できませんでした。',
      )
    } finally {
      setPdfPublishing(false)
    }
  }

  useEffect(() => {
    setPdfInterruptedPublicationId('')
    setPdfPublicationDraftId(requiredDocumentId ?? '')
    setPdfPublicationRequestId('')
    if (
      !browserPublishingEnabled ||
      !isAuthenticated ||
      !adminToken ||
      !activeLectureSessionId
    ) {
      return
    }

    let active = true
    void (async () => {
      const {
        browserPdfPublicationClient,
        forgetBrowserPdfPublication,
        rememberBrowserPdfPublication,
        restoreBrowserPdfPublication,
      } = await import('../pdf/browserPdfPublicationClient')
      if (!active) return
      let stored = restoreBrowserPdfPublication(activeLectureSessionId)
      if (!stored) {
        const discovered = await browserPdfPublicationClient.discover({
          adminToken,
          lectureSessionId: activeLectureSessionId,
        })
        if (!discovered || !active) return
        stored = discovered
        rememberBrowserPdfPublication(discovered)
      }
      if (!active) return
      setPdfInterruptedPublicationId(stored.publicationId)
      const status = await browserPdfPublicationClient.status({
        adminToken,
        lectureSessionId: activeLectureSessionId,
        publicationId: stored.publicationId,
      })
      if (!active) return
      if (['uploaded', 'committed'].includes(status.status)) {
        setPublisherMessage('中断したPDF公開を再開しています…')
        const finalized = await browserPdfPublicationClient.finalize({
          adminToken,
          lectureSessionId: activeLectureSessionId,
          publicationId: stored.publicationId,
        })
        if (!active) return
        setPdfDocumentInput(finalized.documentId ?? stored.documentId)
        if (finalized.status === 'active') {
          forgetBrowserPdfPublication(activeLectureSessionId)
          setPdfInterruptedPublicationId('')
        }
        await refreshAdminPdfDocumentsRef.current(
          activeLectureSessionId,
          adminToken,
        )
        if (active) {
          onPublicationActivatedRef.current(activeLectureSessionId)
          setPublisherMessage('中断したPDFの公開が完了しました。')
        }
        return
      }
      if (status.status === 'active') {
        forgetBrowserPdfPublication(activeLectureSessionId)
        setPdfInterruptedPublicationId('')
        setPdfDocumentInput(status.documentId ?? stored.documentId)
        await refreshAdminPdfDocumentsRef.current(
          activeLectureSessionId,
          adminToken,
        )
        if (active) {
          onPublicationActivatedRef.current(activeLectureSessionId)
          setPublisherMessage('PDFは公開済みです。')
        }
        return
      }
      if (status.status === 'pending') {
        setPdfPublicationDraftId(stored.documentId)
        setPdfPublicationRequestId(stored.idempotencyKey)
        setPublisherMessage(
          Date.parse(stored.expiresAt) <= Date.now()
            ? '前回のPDF公開は期限切れです。破棄してから新しい公開を開始してください。'
            : '前回の送信は完了していません。同じPDFを選択すると再開できます。別のPDFを使う場合は先に中断した公開を破棄してください。',
        )
        return
      }
      forgetBrowserPdfPublication(activeLectureSessionId)
      setPdfInterruptedPublicationId('')
    })().catch((error: unknown) => {
      if (!active) return
      setPublisherMessage(
        error instanceof Error
          ? `中断したPDF公開の状態を確認できませんでした: ${error.message}`
          : '中断したPDF公開の状態を確認できませんでした。',
      )
    })

    return () => {
      active = false
    }
  }, [
    activeLectureSessionId,
    adminToken,
    browserPublishingEnabled,
    isAuthenticated,
    requiredDocumentId,
    setPdfDocumentInput,
    setPublisherMessage,
  ])

  function resetBrowserPdfPublication() {
    setPdfInterruptedPublicationId('')
    setPdfPublicationDraftId(requiredDocumentId ?? '')
    setPdfPublicationRequestId('')
  }

  return {
    abortInterruptedPdfPublication,
    pdfInterruptedPublicationId,
    pdfPublicationDraftId,
    pdfPublicationRequestId,
    publishPdfDocumentInBrowser,
    resetBrowserPdfPublication,
    setPdfPublicationDraftId,
    setPdfPublicationRequestId,
  }
}
