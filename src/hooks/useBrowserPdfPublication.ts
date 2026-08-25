import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { AdminOperationCredentialInput } from '../lib/adminAuth/adminOperationCredential'
import type { BrowserPdfPublicationActivation } from '../pdf/browserPdfPublicationClient'
import { rememberBrowserPdfExtraction } from '../pdf/adminPdfExtraction'
import { preflightBrowserPdf } from '../pdf/browserPdfPreflight'

const PDF_PUBLICATION_RECOVERY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000]

type PdfPublicationRecoveryControl = {
  cancelScheduled: () => void
  resumeNow: () => void
  schedule: () => void
}

type UseBrowserPdfPublicationInput = {
  activeLectureSessionId: string | null
  adminToken: AdminOperationCredentialInput
  browserPublishingEnabled: boolean
  isAuthenticated: boolean
  pdfDisplayName: string
  pdfDownloadEnabled: boolean
  pdfFile: File | null
  onPublicationActivated: (
    lectureSessionId: string,
    activation: BrowserPdfPublicationActivation,
  ) => void
  requiredDocumentId?: string | null
  refreshAdminPdfDocuments: (
    lectureSessionId?: string,
    token?: AdminOperationCredentialInput,
  ) => Promise<boolean>
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
  const publicationRecoveryControlRef =
    useRef<PdfPublicationRecoveryControl | null>(null)
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
    let finalizationRecoveryReady = false

    try {
      setPublisherMessage('PDFをブラウザ内で確認しています…')
      const publicationModule =
        await import('../pdf/browserPdfPublicationClient')
      const {
        browserPdfPublicationClient,
        forgetBrowserPdfPublication,
        prepareBrowserPdfPublicationFinalization,
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
      const finalization = prepareBrowserPdfPublicationFinalization(publication)
      finalizationRecoveryReady = true
      let finalized = await browserPdfPublicationClient.finalize({
        adminToken,
        finalizeRequestId: finalization.finalizeRequestId,
        lectureSessionId: targetLectureSessionId,
        publicationId: publication.publicationId,
      })
      for (const retryDelayMs of [250, 1_000]) {
        if (finalized.status === 'active') break
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, retryDelayMs)
        })
        finalized = await browserPdfPublicationClient.finalize({
          adminToken,
          finalizeRequestId: finalization.finalizeRequestId,
          lectureSessionId: targetLectureSessionId,
          publicationId: publication.publicationId,
        })
      }

      if (finalized.status !== 'active') {
        setPublisherMessage(
          '資料の送信は完了しました。公開の最終確定を再開しています。',
        )
        publicationRecoveryControlRef.current?.schedule()
        return
      }

      setPdfDocumentInput(finalized.documentId ?? documentId)
      setPdfFile(null)
      setPdfPublicationDraftId(requiredDocumentId ?? '')
      setPdfPublicationRequestId('')
      setPdfDisplayName('')
      rememberBrowserPdfExtraction({
        documentId,
        lectureSessionId: targetLectureSessionId,
        preflight,
      })
      const documentsReady = await refreshAdminPdfDocuments(
        targetLectureSessionId,
        adminToken,
      )
      if (!documentsReady) {
        setPublisherMessage('公開は完了しました。資料一覧を再同期しています…')
        publicationRecoveryControlRef.current?.schedule()
        return
      }
      onPublicationActivatedRef.current(targetLectureSessionId, {
        documentId: finalized.documentId ?? documentId,
        documentVersion: finalized.documentVersion!,
        manifestVersion: finalized.manifestVersion!,
      })
      forgetBrowserPdfPublication(targetLectureSessionId)
      setPdfInterruptedPublicationId('')
      const aiAvailabilityMessage = !preflight.textAvailable
        ? ' この資料は文字情報がないため、AI分析は利用できません。'
        : preflight.textTruncated
          ? ' AI分析には先頭20,000文字を使用します。'
          : ''
      setPublisherMessage(
        `学生への公開が完了しました（${preflight.pageCount}ページ・${(
          preflight.byteSize /
          1024 /
          1024
        ).toFixed(
          2,
        )}MB）。現在の講義資料として表示しています。${aiAvailabilityMessage}`,
      )
    } catch (error) {
      if (finalizationRecoveryReady) {
        setPublisherMessage(
          '資料の送信は完了しました。公開の最終確定を再開しています。',
        )
        publicationRecoveryControlRef.current?.schedule()
        return
      }
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
    const recoveryControl = publicationRecoveryControlRef.current
    // Fence any scheduled or in-flight recovery before asking the server to
    // discard. The server remains authoritative if finalize won the race.
    recoveryControl?.cancelScheduled()
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
      // Abort can lose to an already committed finalize. Reconcile that
      // authoritative result instead of leaving the local recovery fenced.
      recoveryControl?.resumeNow()
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
    let controlVersion = 0
    let immediateRetryRequested = false
    let recoveryInFlight = false
    let scheduledRetryRequested = false
    let retryDeadline = Number.POSITIVE_INFINITY
    let retryIndex = 0
    let retryTimer: number | null = null

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const markRecoveryDeadlineReached = () => {
      clearRetryTimer()
      setPublisherMessage(
        'PDF公開の再開期限が終了しました。中断した公開を破棄してやり直してください。',
      )
    }

    let runRecovery: () => Promise<void>
    const scheduleRecovery = () => {
      if (!active || retryTimer !== null) return
      if (recoveryInFlight) {
        scheduledRetryRequested = true
        return
      }
      const remainingMs = retryDeadline - Date.now()
      if (remainingMs <= 0) {
        markRecoveryDeadlineReached()
        return
      }
      const delayMs = Math.min(
        PDF_PUBLICATION_RECOVERY_DELAYS_MS[
          Math.min(retryIndex, PDF_PUBLICATION_RECOVERY_DELAYS_MS.length - 1)
        ],
        remainingMs,
      )
      retryIndex = Math.min(
        retryIndex + 1,
        PDF_PUBLICATION_RECOVERY_DELAYS_MS.length - 1,
      )
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        void runRecovery()
      }, delayMs)
    }

    const resumeRecoveryNow = () => {
      if (!active) return
      clearRetryTimer()
      retryIndex = 0
      if (recoveryInFlight) {
        immediateRetryRequested = true
        return
      }
      void runRecovery()
    }

    const cancelScheduledRecovery = () => {
      controlVersion += 1
      clearRetryTimer()
      immediateRetryRequested = false
      scheduledRetryRequested = false
      retryDeadline = Number.POSITIVE_INFINITY
      retryIndex = 0
    }

    publicationRecoveryControlRef.current = {
      cancelScheduled: cancelScheduledRecovery,
      resumeNow: resumeRecoveryNow,
      schedule: scheduleRecovery,
    }

    runRecovery = async () => {
      if (!active || recoveryInFlight) return
      recoveryInFlight = true
      const currentControlVersion = controlVersion
      const isCurrent = () => active && currentControlVersion === controlVersion

      try {
        const {
          browserPdfPublicationClient,
          forgetBrowserPdfPublication,
          prepareBrowserPdfPublicationFinalization,
          rememberBrowserPdfPublication,
          restoreBrowserPdfPublication,
        } = await import('../pdf/browserPdfPublicationClient')
        if (!isCurrent()) return
        let stored = restoreBrowserPdfPublication(activeLectureSessionId)
        if (!stored) {
          const discovered = await browserPdfPublicationClient.discover({
            adminToken,
            lectureSessionId: activeLectureSessionId,
          })
          if (!discovered || !isCurrent()) return
          stored = discovered
          rememberBrowserPdfPublication(discovered)
        }
        if (!isCurrent()) return
        retryDeadline = Date.parse(stored.expiresAt)
        setPdfInterruptedPublicationId(stored.publicationId)
        if (retryDeadline <= Date.now()) {
          markRecoveryDeadlineReached()
          return
        }

        if (navigator.onLine === false) {
          scheduleRecovery()
          return
        }

        const status = await browserPdfPublicationClient.status({
          adminToken,
          lectureSessionId: activeLectureSessionId,
          publicationId: stored.publicationId,
        })
        if (!isCurrent()) return

        const activatePublication = async (
          activation: typeof status,
          message: string,
        ) => {
          if (
            !activation.documentVersion ||
            typeof activation.manifestVersion !== 'number'
          ) {
            throw new Error('PDF公開完了状態を確認できません。')
          }
          const activeDocumentId = activation.documentId ?? stored.documentId
          setPdfDocumentInput(activeDocumentId)
          setPdfFile(null)
          setPdfPublicationDraftId(requiredDocumentId ?? '')
          setPdfPublicationRequestId('')
          setPdfDisplayName('')
          const documentsReady = await refreshAdminPdfDocumentsRef.current(
            activeLectureSessionId,
            adminToken,
          )
          if (!isCurrent()) return
          if (!documentsReady) {
            setPublisherMessage(
              '公開は完了しました。資料一覧を再同期しています…',
            )
            scheduleRecovery()
            return
          }
          onPublicationActivatedRef.current(activeLectureSessionId, {
            documentId: activeDocumentId,
            documentVersion: activation.documentVersion,
            manifestVersion: activation.manifestVersion,
          })
          forgetBrowserPdfPublication(activeLectureSessionId)
          setPdfInterruptedPublicationId('')
          clearRetryTimer()
          setPublisherMessage(message)
        }

        if (status.status === 'active') {
          await activatePublication(status, 'PDFは公開済みです。')
          return
        }

        if (['uploaded', 'committed'].includes(status.status)) {
          setPublisherMessage('中断したPDF公開を再開しています…')
          const finalization = prepareBrowserPdfPublicationFinalization(stored)
          const finalized = await browserPdfPublicationClient.finalize({
            adminToken,
            finalizeRequestId: finalization.finalizeRequestId,
            lectureSessionId: activeLectureSessionId,
            publicationId: stored.publicationId,
          })
          if (!isCurrent()) return
          if (finalized.status === 'active') {
            await activatePublication(
              finalized,
              '中断したPDFの公開が完了しました。',
            )
            return
          }
          setPublisherMessage(
            '資料の送信は完了しました。公開の最終確定を再開しています。',
          )
          scheduleRecovery()
          return
        }

        if (status.status === 'pending') {
          setPdfPublicationDraftId(stored.documentId)
          setPdfPublicationRequestId(stored.idempotencyKey)
          setPublisherMessage(
            '前回の送信は完了していません。同じPDFを選択すると再開できます。別のPDFを使う場合は先に中断した公開を破棄してください。',
          )
          return
        }

        forgetBrowserPdfPublication(activeLectureSessionId)
        setPdfInterruptedPublicationId('')
        clearRetryTimer()
      } catch (error: unknown) {
        if (!isCurrent()) return
        setPublisherMessage(
          error instanceof Error
            ? `中断したPDF公開の状態を確認できませんでした。自動で再試行します: ${error.message}`
            : '中断したPDF公開の状態を確認できませんでした。自動で再試行します。',
        )
        if (Number.isFinite(retryDeadline)) {
          scheduleRecovery()
        }
      } finally {
        recoveryInFlight = false
        if (active && immediateRetryRequested) {
          immediateRetryRequested = false
          scheduledRetryRequested = false
          resumeRecoveryNow()
        } else if (active && scheduledRetryRequested) {
          scheduledRetryRequested = false
          scheduleRecovery()
        }
      }
    }

    const handleOnline = () => resumeRecoveryNow()
    const handlePageShow = () => resumeRecoveryNow()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') resumeRecoveryNow()
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    void runRecovery()

    return () => {
      active = false
      controlVersion += 1
      clearRetryTimer()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (
        publicationRecoveryControlRef.current?.resumeNow === resumeRecoveryNow
      ) {
        publicationRecoveryControlRef.current = null
      }
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
    publicationRecoveryControlRef.current?.cancelScheduled()
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
