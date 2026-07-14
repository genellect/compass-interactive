import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useFullscreen } from '../../hooks/useFullscreen'
import { isPhase3PrivatePdfEnabled } from '../../lib/featureFlags'
import { getLecturePdfAsset } from '../../pdf/lectureAssets'
import {
  resolveRuntimePdf,
  type RuntimePdfDocument,
} from '../../pdf/pdfDelivery'
import { AppIcon } from '../AppIcon'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString()

const DEFAULT_PAGE_ASPECT_RATIO = 16 / 9
const MAX_RENDER_SCALE = 5
const MIN_QUALITY_SCALE = 2

type SyncedPdfViewerProps = {
  documentId: string | null
  documentVersion?: string | null
  lectureSessionId?: string | null
  manifestVersion?: number
  pageCount?: number | null
  presenterLocked?: boolean
  remotePage?: number | null
  visible?: boolean
}

export function SyncedPdfViewer({
  documentId,
  documentVersion = null,
  lectureSessionId = null,
  manifestVersion = 0,
  pageCount = null,
  presenterLocked = false,
  remotePage,
  visible = true,
}: SyncedPdfViewerProps) {
  const legacyAsset = getLecturePdfAsset(documentId)
  const usePrivateDelivery = Boolean(
    isPhase3PrivatePdfEnabled &&
    lectureSessionId &&
    documentId &&
    documentVersion &&
    manifestVersion > 0 &&
    visible,
  )
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const remotePageRef = useRef(remotePage)
  remotePageRef.current = remotePage
  const renderTaskRef = useRef<ReturnType<
    Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']
  > | null>(null)
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [followPresenter, setFollowPresenter] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isResolvingAsset, setIsResolvingAsset] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [runtimeDocument, setRuntimeDocument] =
    useState<RuntimePdfDocument | null>(null)
  const [runtimeUrl, setRuntimeUrl] = useState('')
  const runtimeResolverRef = useRef<Awaited<
    ReturnType<typeof resolveRuntimePdf>
  > | null>(null)
  const [resolveAttempt, setResolveAttempt] = useState(0)
  const [pageAspectRatio, setPageAspectRatio] = useState(
    DEFAULT_PAGE_ASPECT_RATIO,
  )
  const {
    errorMessage: fullscreenErrorMessage,
    isFullscreen: isPdfFullscreen,
    isFullscreenSupported,
    toggleFullscreen,
  } = useFullscreen(stageRef)
  const assetTitle = runtimeDocument?.displayName ?? legacyAsset?.title ?? null
  const assetUrl = usePrivateDelivery ? runtimeUrl : (legacyAsset?.url ?? '')
  const expectedPageCount =
    runtimeDocument?.pageCount ?? pageCount ?? legacyAsset?.pageCount ?? null

  useEffect(() => {
    let active = true
    runtimeResolverRef.current = null
    setRuntimeDocument(null)
    setRuntimeUrl('')

    if (
      !usePrivateDelivery ||
      !lectureSessionId ||
      !documentId ||
      !documentVersion
    ) {
      setIsResolvingAsset(false)
      return () => {
        active = false
      }
    }

    setIsResolvingAsset(true)
    setErrorMessage('')
    void resolveRuntimePdf({
      documentId,
      documentVersion,
      lectureSessionId,
      manifestVersion,
    })
      .then(async (resolved) => {
        const url = await resolved.getAccessUrl('inline')
        if (!active) return
        runtimeResolverRef.current = resolved
        setRuntimeDocument(resolved.document)
        setRuntimeUrl(url)
      })
      .catch((error: unknown) => {
        if (!active) return
        setErrorMessage(
          error instanceof Error
            ? `PDF資料の認証に失敗しました: ${error.message}`
            : 'PDF資料の認証に失敗しました。',
        )
      })
      .finally(() => {
        if (active) setIsResolvingAsset(false)
      })

    return () => {
      active = false
    }
  }, [
    documentId,
    documentVersion,
    lectureSessionId,
    manifestVersion,
    resolveAttempt,
    usePrivateDelivery,
  ])

  const renderPage = useCallback(
    async (pageNumber: number, document: PDFDocumentProxy) => {
      const canvas = canvasRef.current
      const stage = stageRef.current
      if (!canvas || !stage) {
        return
      }

      renderTaskRef.current?.cancel()
      const page = await document.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      setPageAspectRatio(baseViewport.width / baseViewport.height)
      const stageRect = stage.getBoundingClientRect()
      const displayScale = Math.min(
        Math.max(stageRect.width, 320) / baseViewport.width,
        Math.max(stageRect.height, 180) / baseViewport.height,
      )
      const renderScale = Math.min(
        MAX_RENDER_SCALE,
        displayScale *
          Math.max(window.devicePixelRatio || 1, MIN_QUALITY_SCALE),
      )
      const displayViewport = page.getViewport({ scale: displayScale })
      const renderViewport = page.getViewport({ scale: renderScale })
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) {
        throw new Error('Canvas rendering context is unavailable.')
      }

      canvas.width = Math.floor(renderViewport.width)
      canvas.height = Math.floor(renderViewport.height)
      canvas.style.width = `${Math.floor(displayViewport.width)}px`
      canvas.style.height = `${Math.floor(displayViewport.height)}px`
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)

      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport: renderViewport,
      })
      renderTaskRef.current = renderTask
      try {
        await renderTask.promise
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === 'RenderingCancelledException'
        ) {
          return
        }
        throw error
      } finally {
        renderTaskRef.current = null
      }
    },
    [],
  )

  const moveToPage = useCallback(
    async (nextPage: number, manual = false) => {
      if (!pdfDocument || nextPage < 1 || nextPage > totalPages) {
        return
      }
      if (manual && !presenterLocked) {
        setFollowPresenter(false)
      }
      setCurrentPage(nextPage)
      setErrorMessage('')
      try {
        await renderPage(nextPage, pdfDocument)
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? `PDFページの描画に失敗しました: ${error.message}`
            : 'PDFページの描画に失敗しました。',
        )
      }
    },
    [pdfDocument, presenterLocked, renderPage, totalPages],
  )

  useEffect(() => {
    let active = true
    setPdfDocument(null)
    setCurrentPage(1)
    setTotalPages(0)
    setFollowPresenter(true)
    setPageAspectRatio(DEFAULT_PAGE_ASPECT_RATIO)
    setErrorMessage('')

    if (!assetUrl) {
      setIsLoading(false)
      return () => {
        active = false
      }
    }

    setIsLoading(true)
    const loadingTask = pdfjsLib.getDocument({
      rangeChunkSize: 1024 * 1024,
      url: assetUrl,
    })
    void loadingTask.promise
      .then(async (loadedPdf) => {
        if (!active) {
          return
        }
        const initialPage = Math.min(
          Math.max(remotePageRef.current ?? 1, 1),
          loadedPdf.numPages,
        )
        setPdfDocument(loadedPdf)
        setCurrentPage(initialPage)
        setTotalPages(loadedPdf.numPages)
        await renderPage(initialPage, loadedPdf)
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }
        setErrorMessage(
          error instanceof Error
            ? `PDFの読み込みに失敗しました: ${error.message}`
            : 'PDFの読み込みに失敗しました。',
        )
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
      renderTaskRef.current?.cancel()
      void loadingTask.destroy()
    }
  }, [assetUrl, renderPage])

  useEffect(() => {
    if (!pdfDocument || !remotePage || (!followPresenter && !presenterLocked)) {
      return
    }
    if (remotePage === currentPage || remotePage > totalPages) {
      return
    }
    void moveToPage(remotePage)
  }, [
    currentPage,
    followPresenter,
    moveToPage,
    pdfDocument,
    presenterLocked,
    remotePage,
    totalPages,
  ])

  useEffect(() => {
    if (!pdfDocument) {
      return
    }
    const timer = window.setTimeout(() => {
      void renderPage(currentPage, pdfDocument)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [currentPage, isPdfFullscreen, pdfDocument, renderPage])

  async function resumePresenterFollow() {
    setFollowPresenter(true)
    if (remotePage) {
      await moveToPage(remotePage)
    }
  }

  async function downloadPdf() {
    try {
      const resolver = runtimeResolverRef.current
      if (!resolver) return
      const url = await resolver.getAccessUrl('download')
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.rel = 'noopener'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? `PDFのダウンロードに失敗しました: ${error.message}`
          : 'PDFのダウンロードに失敗しました。',
      )
    }
  }

  return (
    <div className="local-pdf-viewer synced-pdf-viewer">
      <div className="pdf-toolbar">
        <div className="pdf-title-group">
          <span className="section-icon">
            <AppIcon name="book" size={17} />
          </span>
          <div>
            <p className="eyebrow">MATERIAL</p>
            <strong>{assetTitle ?? '資料を待っています'}</strong>
          </div>
        </div>
        <div className="pdf-page-controls">
          {presenterLocked ? (
            <>
              <span className="presenter-sync-badge">
                <i /> 教員同期
              </span>
              <span className="metric">
                {pdfDocument ? `${currentPage} / ${totalPages}` : '— / —'}
              </span>
            </>
          ) : (
            <>
              <button
                aria-label="前のページ"
                className="icon-button"
                disabled={!pdfDocument || currentPage <= 1 || isLoading}
                onClick={() => void moveToPage(currentPage - 1, true)}
                type="button"
              >
                <AppIcon name="arrow-left" size={19} />
              </button>
              <span className="metric">
                {pdfDocument ? `${currentPage} / ${totalPages}` : '— / —'}
              </span>
              <button
                aria-label="次のページ"
                className="icon-button"
                disabled={
                  !pdfDocument || currentPage >= totalPages || isLoading
                }
                onClick={() => void moveToPage(currentPage + 1, true)}
                type="button"
              >
                <AppIcon name="arrow-right" size={19} />
              </button>
            </>
          )}
        </div>
        {!presenterLocked ? (
          <button
            className={`follow-button ${followPresenter ? 'is-following' : ''}`}
            disabled={!pdfDocument || followPresenter}
            onClick={() => void resumePresenterFollow()}
            type="button"
          >
            <span className="live-dot" />
            {followPresenter ? '教員と同期中' : '教員のページに戻る'}
          </button>
        ) : null}
        <button
          className="secondary-button pdf-fullscreen-button"
          disabled={!isFullscreenSupported || !pdfDocument || isLoading}
          onClick={() => void toggleFullscreen()}
          type="button"
        >
          {isPdfFullscreen ? '全画面を終了' : '大きく表示'}
        </button>
        {runtimeDocument?.downloadEnabled ? (
          <button
            className="secondary-button"
            disabled={!pdfDocument || isLoading}
            onClick={() => void downloadPdf()}
            type="button"
          >
            PDFを保存
          </button>
        ) : null}
      </div>

      {!presenterLocked && pdfDocument ? (
        <p className="note">
          {followPresenter
            ? '教員がページを進めると、自動で同じページに移動します。'
            : 'いまは自分のペースで資料を見ています。'}
        </p>
      ) : null}
      {expectedPageCount && expectedPageCount !== totalPages && pdfDocument ? (
        <p className="error-note">資料情報を更新できませんでした。</p>
      ) : null}
      {!legacyAsset && !usePrivateDelivery && documentId ? (
        <p className="error-note">指定されたPDF資料が見つかりません。</p>
      ) : null}
      {errorMessage ? <p className="error-note">{errorMessage}</p> : null}
      {errorMessage && usePrivateDelivery ? (
        <button
          className="secondary-button"
          onClick={() => setResolveAttempt((attempt) => attempt + 1)}
          type="button"
        >
          PDFを再試行
        </button>
      ) : null}
      {fullscreenErrorMessage ? (
        <p className="error-note">{fullscreenErrorMessage}</p>
      ) : null}
      {isLoading || isResolvingAsset ? (
        <p className="note">講義資料を開いています…</p>
      ) : null}

      <div
        className="display-slide-frame pdf-stage"
        ref={stageRef}
        style={{ aspectRatio: pageAspectRatio }}
      >
        {pdfDocument ? (
          <canvas className="pdf-canvas" ref={canvasRef} />
        ) : (
          <div>
            <span className="empty-slide-icon">
              <AppIcon name="book" size={28} />
            </span>
            <p className="eyebrow">LECTURE MATERIAL</p>
            <h2>
              {assetTitle
                ? '資料を開いています'
                : '教員からの資料を待っています'}
            </h2>
            <p>資料が共有されると、この画面に自動で表示されます。</p>
          </div>
        )}
      </div>
    </div>
  )
}
