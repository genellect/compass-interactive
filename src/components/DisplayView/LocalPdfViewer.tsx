import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useFullscreen } from '../../hooks/useFullscreen'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString()

const DEFAULT_PAGE_ASPECT_RATIO = 16 / 9
const MAX_RENDER_SCALE = 5
const MIN_QUALITY_SCALE = 2
const STAGE_INSET = 0

type LocalPdfViewerProps = {
  remotePage?: number | null
}

export function LocalPdfViewer({ remotePage }: LocalPdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const renderTaskRef = useRef<ReturnType<
    Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']
  > | null>(null)
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [fileName, setFileName] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
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
      const availableWidth = Math.max(stageRect.width - STAGE_INSET, 320)
      const availableHeight = Math.max(stageRect.height - STAGE_INSET, 180)
      const displayScale = Math.min(
        availableWidth / baseViewport.width,
        availableHeight / baseViewport.height,
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

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (file.type !== 'application/pdf') {
      setErrorMessage('PDFファイルを選択してください。')
      return
    }

    setIsLoading(true)
    setErrorMessage('')

    try {
      const buffer = await file.arrayBuffer()
      const loadedPdf = await pdfjsLib.getDocument({ data: buffer }).promise
      const initialPage =
        remotePage && remotePage >= 1 && remotePage <= loadedPdf.numPages
          ? remotePage
          : 1
      setPdfDocument(loadedPdf)
      setFileName(file.name)
      setCurrentPage(initialPage)
      setTotalPages(loadedPdf.numPages)
      await renderPage(initialPage, loadedPdf)
    } catch (error) {
      setPdfDocument(null)
      setFileName('')
      setCurrentPage(1)
      setTotalPages(0)
      setPageAspectRatio(DEFAULT_PAGE_ASPECT_RATIO)
      setErrorMessage(
        error instanceof Error
          ? `PDFの読み込みに失敗しました: ${error.message}`
          : 'PDFの読み込みに失敗しました。',
      )
    } finally {
      setIsLoading(false)
    }
  }

  const moveToPage = useCallback(async (nextPage: number) => {
    if (!pdfDocument || nextPage < 1 || nextPage > totalPages) {
      return
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
  }, [pdfDocument, renderPage, totalPages])

  useEffect(() => {
    if (!pdfDocument) {
      return
    }
    const document = pdfDocument

    function handleResize() {
      void renderPage(currentPage, document)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [currentPage, pdfDocument, renderPage])

  useEffect(() => {
    if (!pdfDocument) {
      return
    }

    const resizeTimer = window.setTimeout(() => {
      void renderPage(currentPage, pdfDocument)
    }, 120)

    return () => window.clearTimeout(resizeTimer)
  }, [currentPage, isPdfFullscreen, pdfDocument, renderPage])

  useEffect(() => {
    if (!isPdfFullscreen || !pdfDocument) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        void moveToPage(currentPage - 1)
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        void moveToPage(currentPage + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPage, isPdfFullscreen, moveToPage, pdfDocument])

  useEffect(() => {
    if (!pdfDocument || !remotePage) {
      return
    }

    if (remotePage < 1 || remotePage > totalPages || remotePage === currentPage) {
      return
    }

    void moveToPage(remotePage)
  }, [currentPage, moveToPage, pdfDocument, remotePage, totalPages])

  useEffect(
    () => () => {
      renderTaskRef.current?.cancel()
    },
    [],
  )

  return (
    <div className="local-pdf-viewer">
      <div className="pdf-toolbar">
        <label className="secondary-button pdf-file-button">
          PDFを選択
          <input
            accept="application/pdf"
            aria-label="PDFファイル"
            onChange={handleFileChange}
            type="file"
          />
        </label>
        <div className="pdf-page-controls">
          <button
            className="secondary-button"
            disabled={!pdfDocument || currentPage <= 1 || isLoading}
            onClick={() => void moveToPage(currentPage - 1)}
            type="button"
          >
            前へ
          </button>
          <span className="metric">
            {pdfDocument ? `${currentPage} / ${totalPages}` : '0 / 0'}
          </span>
          <button
            className="secondary-button"
            disabled={!pdfDocument || currentPage >= totalPages || isLoading}
            onClick={() => void moveToPage(currentPage + 1)}
            type="button"
          >
            次へ
          </button>
        </div>
        <button
          className="secondary-button"
          disabled={!isFullscreenSupported || isLoading}
          onClick={() => void toggleFullscreen()}
          type="button"
        >
          {isPdfFullscreen ? '全画面を終了' : 'PDFを全画面表示'}
        </button>
      </div>

      {fileName ? <p className="note pdf-file-name">{fileName}</p> : null}
      {errorMessage ? <p className="error-note">{errorMessage}</p> : null}
      {fullscreenErrorMessage ? (
        <p className="error-note">{fullscreenErrorMessage}</p>
      ) : null}
      {isLoading ? <p className="note">PDFを読み込んでいます。</p> : null}

      <div
        className="display-slide-frame pdf-stage"
        ref={stageRef}
        style={{ aspectRatio: pageAspectRatio }}
      >
        {pdfDocument ? (
          <canvas className="pdf-canvas" ref={canvasRef} />
        ) : (
          <div>
            <p className="eyebrow">スライド</p>
            <h2>PDFスライドを表示</h2>
            <p>PowerPointをPDF化したスライドをここに表示します。</p>
            <span>0 / 0</span>
          </div>
        )}
      </div>
    </div>
  )
}
