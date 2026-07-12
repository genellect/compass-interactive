import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useFullscreen } from '../../hooks/useFullscreen'
import { getLecturePdfAsset } from '../../pdf/lectureAssets'
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
  presenterLocked?: boolean
  remotePage?: number | null
}

export function SyncedPdfViewer({
  documentId,
  presenterLocked = false,
  remotePage,
}: SyncedPdfViewerProps) {
  const asset = getLecturePdfAsset(documentId)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const renderTaskRef = useRef<ReturnType<
    Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']
  > | null>(null)
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [followPresenter, setFollowPresenter] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [pageAspectRatio, setPageAspectRatio] = useState(
    DEFAULT_PAGE_ASPECT_RATIO,
  )
  const {
    errorMessage: fullscreenErrorMessage,
    isFullscreen: isPdfFullscreen,
    isFullscreenSupported,
    toggleFullscreen,
  } = useFullscreen(stageRef)

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
        displayScale * Math.max(window.devicePixelRatio || 1, MIN_QUALITY_SCALE),
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
        if (error instanceof Error && error.name === 'RenderingCancelledException') {
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

    if (!asset) {
      setIsLoading(false)
      return () => {
        active = false
      }
    }

    setIsLoading(true)
    const loadingTask = pdfjsLib.getDocument({ url: asset.url })
    void loadingTask.promise
      .then(async (loadedPdf) => {
        if (!active) {
          return
        }
        const initialPage = 1
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
  }, [asset, renderPage])

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

  return (
    <div className="local-pdf-viewer synced-pdf-viewer">
      <div className="pdf-toolbar">
        <div className="pdf-title-group">
          <span className="section-icon"><AppIcon name="book" size={17} /></span>
          <div>
            <p className="eyebrow">MATERIAL</p>
            <strong>{asset?.title ?? '資料を待っています'}</strong>
          </div>
        </div>
        <div className="pdf-page-controls">
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
            disabled={!pdfDocument || currentPage >= totalPages || isLoading}
            onClick={() => void moveToPage(currentPage + 1, true)}
            type="button"
          >
            <AppIcon name="arrow-right" size={19} />
          </button>
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
      </div>

      {!presenterLocked && pdfDocument ? (
        <p className="note">
          {followPresenter
            ? '教員がページを進めると、自動で同じページに移動します。'
            : 'いまは自分のペースで資料を見ています。'}
        </p>
      ) : null}
      {asset && asset.pageCount !== totalPages && pdfDocument ? (
        <p className="error-note">資料情報を更新できませんでした。</p>
      ) : null}
      {!asset && documentId ? (
        <p className="error-note">指定されたPDF資料が見つかりません。</p>
      ) : null}
      {errorMessage ? <p className="error-note">{errorMessage}</p> : null}
      {fullscreenErrorMessage ? (
        <p className="error-note">{fullscreenErrorMessage}</p>
      ) : null}
      {isLoading ? <p className="note">講義資料を開いています…</p> : null}

      <div
        className="display-slide-frame pdf-stage"
        ref={stageRef}
        style={{ aspectRatio: pageAspectRatio }}
      >
        {pdfDocument ? (
          <canvas className="pdf-canvas" ref={canvasRef} />
        ) : (
          <div>
            <span className="empty-slide-icon"><AppIcon name="book" size={28} /></span>
            <p className="eyebrow">LECTURE MATERIAL</p>
            <h2>{asset ? '資料を開いています' : '教員からの資料を待っています'}</h2>
            <p>資料が共有されると、この画面に自動で表示されます。</p>
          </div>
        )}
      </div>
    </div>
  )
}
