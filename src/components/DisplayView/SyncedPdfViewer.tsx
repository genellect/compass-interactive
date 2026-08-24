import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { useFullscreen } from '../../hooks/useFullscreen'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import { isPhase3PrivatePdfEnabled } from '../../lib/featureFlags'
import { getLecturePdfAsset } from '../../pdf/lectureAssets'
import {
  resolveRuntimePdf,
  type RuntimePdfDocument,
} from '../../pdf/pdfDelivery'
import { archiveClient } from '../../archive/archiveClient'
import type { LectureArchiveSession } from '../../types/archive'
import { publishDisplayPdfRendered } from '../../display/displayRenderEvents'
import { AppIcon } from '../AppIcon'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const DEFAULT_PAGE_ASPECT_RATIO = 16 / 9
const MAX_RENDER_SCALE = 5
const MIN_QUALITY_SCALE = 2
const CANVAS_BYTES_PER_PIXEL = 4
const MAX_CANVAS_BYTES = 32 * 1024 * 1024
const MAX_CANVAS_PIXELS = Math.floor(MAX_CANVAS_BYTES / CANVAS_BYTES_PER_PIXEL)
const MAX_CANVAS_SIDE = 4_096
const MAX_ADJACENT_PAGE_CACHE_ENTRIES = 2
const MAX_ADJACENT_PAGE_CACHE_BYTES = 48 * 1024 * 1024
const PDF_DOCUMENT_LOAD_TIMEOUT_MS = 15_000
const RETRYABLE_DELIVERY_STATUSES = new Set([401, 403, 408, 416, 429])

type PdfRenderTask = ReturnType<PDFPageProxy['render']>

type CachedPageRender = {
  bytes: number
  canvas: HTMLCanvasElement
  displayHeight: number
  displayWidth: number
  environmentKey: string
  pageAspectRatio: number
  pdfDocument: PDFDocumentProxy
}

type DisplayRenderMetadata = {
  documentId: string
  documentVersion: string
  lectureSessionId: string
  manifestVersion: number
}

function isSameDisplayRenderMetadata(
  left: DisplayRenderMetadata | null,
  right: DisplayRenderMetadata | null,
) {
  if (!left || !right) return left === right
  return (
    left.documentId === right.documentId &&
    left.documentVersion === right.documentVersion &&
    left.lectureSessionId === right.lectureSessionId &&
    left.manifestVersion === right.manifestVersion
  )
}

function releaseCachedPageRenders(cache: Map<number, CachedPageRender>) {
  for (const cached of cache.values()) {
    cached.canvas.width = 0
    cached.canvas.height = 0
  }
  cache.clear()
}

function getPageRenderLayout(page: PDFPageProxy, stage: HTMLElement) {
  const baseViewport = page.getViewport({ scale: 1 })
  const stageRect = stage.getBoundingClientRect()
  const displayScale = Math.min(
    Math.max(stageRect.width, 320) / baseViewport.width,
    Math.max(stageRect.height, 180) / baseViewport.height,
  )
  const devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1)
  const desiredRenderScale = Math.min(
    MAX_RENDER_SCALE,
    displayScale * Math.max(devicePixelRatio, MIN_QUALITY_SCALE),
  )
  const pixelLimitedScale = Math.sqrt(
    MAX_CANVAS_PIXELS / (baseViewport.width * baseViewport.height),
  )
  const sideLimitedScale = Math.min(
    MAX_CANVAS_SIDE / baseViewport.width,
    MAX_CANVAS_SIDE / baseViewport.height,
  )
  const renderScale = Math.max(
    0.01,
    Math.min(desiredRenderScale, pixelLimitedScale, sideLimitedScale),
  )
  return {
    displayViewport: page.getViewport({ scale: displayScale }),
    environmentKey: `${Math.round(stageRect.width)}x${Math.round(
      stageRect.height,
    )}@${devicePixelRatio.toFixed(3)}`,
    pageAspectRatio: baseViewport.width / baseViewport.height,
    renderViewport: page.getViewport({ scale: renderScale }),
  }
}

function isRenderingCancelledError(error: unknown) {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}

function isRetryablePdfDeliveryError(error: unknown) {
  const status = (error as { status?: unknown }).status
  if (
    typeof status === 'number' &&
    (RETRYABLE_DELIVERY_STATUSES.has(status) || status >= 500)
  ) {
    return true
  }
  if (!(error instanceof Error)) return false
  if (/\b(?:401|403|408|416|429|5\d\d)\b/.test(error.message)) return true
  return /failed to fetch|network\s*error|network request failed|range (?:request|response|transport)/i.test(
    error.message,
  )
}

async function cancelAndSettleRenderTask(renderTask: PdfRenderTask) {
  renderTask.cancel()
  try {
    await renderTask.promise
  } catch (error) {
    if (!isRenderingCancelledError(error)) {
      throw error
    }
  }
}

type SyncedPdfViewerProps = {
  adminToken?: AdminOperationCredentialInput
  archiveSession?: LectureArchiveSession | null
  displayToken?: string
  documentId: string | null
  documentVersion?: string | null
  lectureSessionId?: string | null
  manifestVersion?: number
  pageCount?: number | null
  presenterLocked?: boolean
  projector?: boolean
  remotePage?: number | null
  viewMode?: 'archive' | 'closed' | 'live'
  visible?: boolean
}

export function SyncedPdfViewer({
  adminToken,
  archiveSession = null,
  displayToken,
  documentId,
  documentVersion = null,
  lectureSessionId = null,
  manifestVersion = 0,
  pageCount = null,
  presenterLocked = false,
  projector = false,
  remotePage,
  viewMode = 'live',
  visible = true,
}: SyncedPdfViewerProps) {
  const legacyAsset = getLecturePdfAsset(documentId)
  const archivedPdf = archiveSession?.pdf ?? null
  const useArchiveDelivery = Boolean(archiveSession && archivedPdf)
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
  const displayRenderMetadataRef = useRef<DisplayRenderMetadata | null>(null)
  displayRenderMetadataRef.current =
    displayToken &&
    documentId &&
    documentVersion &&
    lectureSessionId &&
    manifestVersion > 0
      ? {
          documentId,
          documentVersion,
          lectureSessionId,
          manifestVersion,
        }
      : null
  const renderTaskRef = useRef<PdfRenderTask | null>(null)
  const adjacentRenderTaskRef = useRef<PdfRenderTask | null>(null)
  const renderRequestRef = useRef(0)
  const adjacentPageCacheRef = useRef(new Map<number, CachedPageRender>())
  const adjacentRenderGenerationRef = useRef(0)
  const renderEnvironmentKeyRef = useRef('')
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
  const [pdfLoadAttempt, setPdfLoadAttempt] = useState(0)
  const privateDeliveryRetryCountRef = useRef(0)
  const privateDeliveryRetryGenerationRef = useRef(0)
  const privateDeliveryRetryInFlightRef = useRef(false)
  const privateDeliveryRetryPageRef = useRef<number | null>(null)
  const [pageAspectRatio, setPageAspectRatio] = useState(
    DEFAULT_PAGE_ASPECT_RATIO,
  )
  const {
    errorMessage: fullscreenErrorMessage,
    isFullscreen: isPdfFullscreen,
    isFullscreenSupported,
    toggleFullscreen,
  } = useFullscreen(stageRef)
  const assetTitle =
    archivedPdf?.displayName ??
    runtimeDocument?.displayName ??
    legacyAsset?.title ??
    null
  const assetUrl =
    useArchiveDelivery || usePrivateDelivery
      ? runtimeUrl
      : (legacyAsset?.url ?? '')
  const expectedPageCount =
    archivedPdf?.pageCount ??
    runtimeDocument?.pageCount ??
    pageCount ??
    legacyAsset?.pageCount ??
    null
  const isLiveView = viewMode === 'live'

  useEffect(() => {
    privateDeliveryRetryGenerationRef.current += 1
    privateDeliveryRetryCountRef.current = 0
    privateDeliveryRetryInFlightRef.current = false
    privateDeliveryRetryPageRef.current = null
  }, [
    documentId,
    documentVersion,
    lectureSessionId,
    manifestVersion,
    resolveAttempt,
    usePrivateDelivery,
  ])

  const retryPrivatePdfDelivery = useCallback(
    async (error: unknown, pageNumber?: number) => {
      if (!usePrivateDelivery || !isRetryablePdfDeliveryError(error)) {
        return false
      }
      if (privateDeliveryRetryInFlightRef.current) return true
      if (privateDeliveryRetryCountRef.current >= 1) return false
      const resolver = runtimeResolverRef.current
      if (!resolver) return false

      const generation = privateDeliveryRetryGenerationRef.current
      privateDeliveryRetryCountRef.current += 1
      privateDeliveryRetryInFlightRef.current = true
      if (pageNumber) privateDeliveryRetryPageRef.current = pageNumber
      setErrorMessage('')
      setIsResolvingAsset(true)
      try {
        const refreshedUrl = await resolver.getAccessUrl('inline', {
          forceRefresh: true,
        })
        if (generation !== privateDeliveryRetryGenerationRef.current) {
          return true
        }
        setRuntimeUrl(refreshedUrl)
        setPdfLoadAttempt((attempt) => attempt + 1)
        return true
      } catch {
        if (generation !== privateDeliveryRetryGenerationRef.current) {
          return true
        }
        setErrorMessage('PDF配信を再接続できませんでした。')
        return true
      } finally {
        if (generation === privateDeliveryRetryGenerationRef.current) {
          privateDeliveryRetryInFlightRef.current = false
          setIsResolvingAsset(false)
        }
      }
    },
    [usePrivateDelivery],
  )

  useEffect(() => {
    let active = true
    const resolverController = new AbortController()
    runtimeResolverRef.current = null
    setRuntimeDocument(null)
    setRuntimeUrl('')

    if (useArchiveDelivery && archiveSession) {
      setIsResolvingAsset(true)
      setErrorMessage('')
      void archiveClient
        .getDocumentAccessUrl(archiveSession, 'inline')
        .then((url) => {
          if (active) setRuntimeUrl(url)
        })
        .catch(() => {
          if (!active) return
          setErrorMessage('アーカイブ資料の認証に失敗しました。')
        })
        .finally(() => {
          if (active) setIsResolvingAsset(false)
        })
      return () => {
        active = false
        resolverController.abort()
      }
    }

    if (
      !usePrivateDelivery ||
      !lectureSessionId ||
      !documentId ||
      !documentVersion
    ) {
      setIsResolvingAsset(false)
      return () => {
        active = false
        resolverController.abort()
      }
    }

    setIsResolvingAsset(true)
    setErrorMessage('')
    void resolveRuntimePdf({
      ...(adminToken ? { adminToken } : {}),
      ...(displayToken ? { displayToken } : {}),
      documentId,
      documentVersion,
      lectureSessionId,
      manifestVersion,
      signal: resolverController.signal,
    })
      .then(async (resolved) => {
        const url = await resolved.getAccessUrl('inline')
        if (!active) return
        runtimeResolverRef.current = resolved
        setRuntimeDocument(resolved.document)
        setRuntimeUrl(url)
      })
      .catch(() => {
        if (!active) return
        setErrorMessage('PDF資料の認証に失敗しました。')
      })
      .finally(() => {
        if (active) setIsResolvingAsset(false)
      })

    return () => {
      active = false
      resolverController.abort()
    }
  }, [
    adminToken,
    archiveSession,
    displayToken,
    documentId,
    documentVersion,
    lectureSessionId,
    manifestVersion,
    resolveAttempt,
    useArchiveDelivery,
    usePrivateDelivery,
  ])

  const preRenderAdjacentPages = useCallback(
    async (
      pdfDocument: PDFDocumentProxy,
      pageNumber: number,
      environmentKey: string,
    ) => {
      const stage = stageRef.current
      if (!stage) return
      const previousAdjacentRender = adjacentRenderTaskRef.current
      if (previousAdjacentRender) {
        try {
          await cancelAndSettleRenderTask(previousAdjacentRender)
        } catch {
          // Neighbor rendering is optional. A failed stale pre-render must not
          // delay the current page or the next bounded pre-render.
        }
        if (adjacentRenderTaskRef.current === previousAdjacentRender) {
          adjacentRenderTaskRef.current = null
        }
      }
      const generation = adjacentRenderGenerationRef.current + 1
      adjacentRenderGenerationRef.current = generation
      const targetPages = [pageNumber + 1, pageNumber - 1].filter(
        (targetPage) => targetPage >= 1 && targetPage <= pdfDocument.numPages,
      )

      for (const targetPage of targetPages) {
        if (generation !== adjacentRenderGenerationRef.current) return
        const existing = adjacentPageCacheRef.current.get(targetPage)
        if (
          existing?.pdfDocument === pdfDocument &&
          existing.environmentKey === environmentKey
        ) {
          continue
        }

        let cacheCanvas: HTMLCanvasElement | null = null
        try {
          const page = await pdfDocument.getPage(targetPage)
          if (generation !== adjacentRenderGenerationRef.current) return
          const layout = getPageRenderLayout(page, stage)
          if (layout.environmentKey !== environmentKey) return
          const renderWidth = Math.max(
            1,
            Math.floor(layout.renderViewport.width),
          )
          const renderHeight = Math.max(
            1,
            Math.floor(layout.renderViewport.height),
          )
          const bytes = renderWidth * renderHeight * CANVAS_BYTES_PER_PIXEL
          if (bytes > MAX_CANVAS_BYTES) continue

          cacheCanvas = window.document.createElement('canvas')
          cacheCanvas.width = renderWidth
          cacheCanvas.height = renderHeight
          const context = cacheCanvas.getContext('2d', { alpha: false })
          if (!context) continue
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, renderWidth, renderHeight)
          const adjacentRenderTask = page.render({
            canvas: cacheCanvas,
            canvasContext: context,
            viewport: layout.renderViewport,
          })
          adjacentRenderTaskRef.current = adjacentRenderTask
          try {
            await adjacentRenderTask.promise
          } finally {
            if (adjacentRenderTaskRef.current === adjacentRenderTask) {
              adjacentRenderTaskRef.current = null
            }
          }
          if (
            generation !== adjacentRenderGenerationRef.current ||
            renderEnvironmentKeyRef.current !== environmentKey
          ) {
            cacheCanvas.width = 0
            cacheCanvas.height = 0
            return
          }

          const cache = adjacentPageCacheRef.current
          const replaced = cache.get(targetPage)
          if (replaced) {
            replaced.canvas.width = 0
            replaced.canvas.height = 0
            cache.delete(targetPage)
          }
          cache.set(targetPage, {
            bytes,
            canvas: cacheCanvas,
            displayHeight: Math.floor(layout.displayViewport.height),
            displayWidth: Math.floor(layout.displayViewport.width),
            environmentKey,
            pageAspectRatio: layout.pageAspectRatio,
            pdfDocument,
          })
          while (
            cache.size > MAX_ADJACENT_PAGE_CACHE_ENTRIES ||
            [...cache.values()].reduce(
              (total, cached) => total + cached.bytes,
              0,
            ) > MAX_ADJACENT_PAGE_CACHE_BYTES
          ) {
            const oldestPage = cache.keys().next().value as number | undefined
            if (oldestPage === undefined) break
            const oldest = cache.get(oldestPage)
            if (oldest) {
              oldest.canvas.width = 0
              oldest.canvas.height = 0
            }
            cache.delete(oldestPage)
          }
        } catch {
          if (cacheCanvas) {
            cacheCanvas.width = 0
            cacheCanvas.height = 0
          }
          // Neighbor rendering is an optimization. The requested page keeps
          // the normal delivery recovery and manual retry behavior.
        }
      }
    },
    [],
  )

  const renderPage = useCallback(
    async (pageNumber: number, pdfDocument: PDFDocumentProxy) => {
      const requestId = renderRequestRef.current + 1
      renderRequestRef.current = requestId
      const renderDisplayMetadata = displayRenderMetadataRef.current
      const canvas = canvasRef.current
      const stage = stageRef.current
      if (!canvas || !stage) {
        return
      }
      const isCurrentRequest = () =>
        requestId === renderRequestRef.current &&
        canvasRef.current === canvas &&
        stageRef.current === stage &&
        isSameDisplayRenderMetadata(
          displayRenderMetadataRef.current,
          renderDisplayMetadata,
        )

      adjacentRenderGenerationRef.current += 1
      adjacentRenderTaskRef.current?.cancel()
      adjacentRenderTaskRef.current = null

      const previousRenderTask = renderTaskRef.current
      if (previousRenderTask) {
        try {
          await cancelAndSettleRenderTask(previousRenderTask)
        } catch (error) {
          if (!isCurrentRequest()) return
          throw error
        }
        if (renderTaskRef.current === previousRenderTask) {
          renderTaskRef.current = null
        }
      }
      if (!isCurrentRequest()) return
      const stageEnvironment = `${Math.round(
        stage.getBoundingClientRect().width,
      )}x${Math.round(stage.getBoundingClientRect().height)}@${Math.max(
        window.devicePixelRatio || 1,
        1,
      ).toFixed(3)}`
      if (renderEnvironmentKeyRef.current !== stageEnvironment) {
        adjacentRenderGenerationRef.current += 1
        releaseCachedPageRenders(adjacentPageCacheRef.current)
        renderEnvironmentKeyRef.current = stageEnvironment
      }

      const cached = adjacentPageCacheRef.current.get(pageNumber)
      if (
        cached?.pdfDocument === pdfDocument &&
        cached.environmentKey === stageEnvironment
      ) {
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) {
          throw new Error('Canvas rendering context is unavailable.')
        }
        setPageAspectRatio(cached.pageAspectRatio)
        canvas.width = cached.canvas.width
        canvas.height = cached.canvas.height
        canvas.style.width = `${cached.displayWidth}px`
        canvas.style.height = `${cached.displayHeight}px`
        context.drawImage(cached.canvas, 0, 0)
        adjacentPageCacheRef.current.delete(pageNumber)
        cached.canvas.width = 0
        cached.canvas.height = 0
        if (isCurrentRequest() && renderDisplayMetadata) {
          publishDisplayPdfRendered({
            ...renderDisplayMetadata,
            page: pageNumber,
          })
        }
        void preRenderAdjacentPages(pdfDocument, pageNumber, stageEnvironment)
        return
      }

      let page
      try {
        page = await pdfDocument.getPage(pageNumber)
      } catch (error) {
        if (!isCurrentRequest()) return
        throw error
      }
      if (!isCurrentRequest()) return
      const layout = getPageRenderLayout(page, stage)
      setPageAspectRatio(layout.pageAspectRatio)
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) {
        throw new Error('Canvas rendering context is unavailable.')
      }

      canvas.width = Math.max(1, Math.floor(layout.renderViewport.width))
      canvas.height = Math.max(1, Math.floor(layout.renderViewport.height))
      canvas.style.width = `${Math.floor(layout.displayViewport.width)}px`
      canvas.style.height = `${Math.floor(layout.displayViewport.height)}px`
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)

      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport: layout.renderViewport,
      })
      renderTaskRef.current = renderTask
      try {
        await renderTask.promise
        if (!isCurrentRequest()) return
        if (renderDisplayMetadata) {
          publishDisplayPdfRendered({
            ...renderDisplayMetadata,
            page: pageNumber,
          })
        }
        void preRenderAdjacentPages(
          pdfDocument,
          pageNumber,
          layout.environmentKey,
        )
      } catch (error) {
        if (isRenderingCancelledError(error) || !isCurrentRequest()) {
          return
        }
        throw error
      } finally {
        if (renderTaskRef.current === renderTask) {
          renderTaskRef.current = null
        }
      }
    },
    [preRenderAdjacentPages],
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
        if (await retryPrivatePdfDelivery(error, nextPage)) return
        setErrorMessage('PDFページの描画に失敗しました。')
      }
    },
    [
      pdfDocument,
      presenterLocked,
      renderPage,
      retryPrivatePdfDelivery,
      totalPages,
    ],
  )

  useEffect(() => {
    let active = true
    const adjacentPageCache = adjacentPageCacheRef.current
    adjacentRenderGenerationRef.current += 1
    releaseCachedPageRenders(adjacentPageCache)
    renderEnvironmentKeyRef.current = ''
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
    const loadingTimeout = window.setTimeout(() => {
      if (!active) return
      const timeoutError = Object.assign(
        new Error('PDF document load timed out.'),
        { status: 408 },
      )
      void retryPrivatePdfDelivery(
        timeoutError,
        privateDeliveryRetryPageRef.current ?? remotePageRef.current ?? 1,
      ).then((retried) => {
        if (!active || retried) return
        setIsLoading(false)
        setErrorMessage('PDFの読み込みに失敗しました。')
        void loadingTask.destroy().catch(() => undefined)
      })
    }, PDF_DOCUMENT_LOAD_TIMEOUT_MS)
    void loadingTask.promise
      .then(async (loadedPdf) => {
        window.clearTimeout(loadingTimeout)
        if (!active) {
          return
        }
        const initialPage = Math.min(
          Math.max(
            privateDeliveryRetryPageRef.current ?? remotePageRef.current ?? 1,
            1,
          ),
          loadedPdf.numPages,
        )
        privateDeliveryRetryPageRef.current = initialPage
        setPdfDocument(loadedPdf)
        setCurrentPage(initialPage)
        setTotalPages(loadedPdf.numPages)
        await renderPage(initialPage, loadedPdf)
        if (!active) return
        privateDeliveryRetryCountRef.current = 0
        privateDeliveryRetryPageRef.current = null
      })
      .catch(async (error: unknown) => {
        window.clearTimeout(loadingTimeout)
        if (!active) {
          return
        }
        if (
          await retryPrivatePdfDelivery(
            error,
            privateDeliveryRetryPageRef.current ?? remotePageRef.current ?? 1,
          )
        ) {
          return
        }
        if (!active) return
        setErrorMessage('PDFの読み込みに失敗しました。')
      })
      .finally(() => {
        window.clearTimeout(loadingTimeout)
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
      window.clearTimeout(loadingTimeout)
      adjacentRenderGenerationRef.current += 1
      releaseCachedPageRenders(adjacentPageCache)
      renderEnvironmentKeyRef.current = ''
      renderRequestRef.current += 1
      renderTaskRef.current?.cancel()
      adjacentRenderTaskRef.current?.cancel()
      adjacentRenderTaskRef.current = null
      void loadingTask.destroy().catch(() => undefined)
    }
  }, [assetUrl, pdfLoadAttempt, renderPage, retryPrivatePdfDelivery])

  useEffect(() => {
    if (
      !isLiveView ||
      !pdfDocument ||
      !remotePage ||
      (!followPresenter && !presenterLocked)
    ) {
      return
    }
    if (remotePage === currentPage || remotePage > totalPages) {
      return
    }
    void moveToPage(remotePage)
  }, [
    currentPage,
    followPresenter,
    isLiveView,
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
    let active = true
    const timer = window.setTimeout(() => {
      void renderPage(currentPage, pdfDocument).catch(
        async (error: unknown) => {
          if (!active) return
          if (await retryPrivatePdfDelivery(error, currentPage)) return
          if (!active) return
          setErrorMessage('PDFページの描画に失敗しました。')
        },
      )
    }, 120)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [
    currentPage,
    isPdfFullscreen,
    pdfDocument,
    renderPage,
    retryPrivatePdfDelivery,
  ])

  useEffect(() => {
    const stage = stageRef.current
    if (!pdfDocument || !stage || typeof ResizeObserver === 'undefined') {
      return
    }
    let active = true
    let frameId: number | null = null
    const initialRect = stage.getBoundingClientRect()
    let lastWidth = Math.round(initialRect.width)
    let lastHeight = Math.round(initialRect.height)
    const observer = new ResizeObserver((entries) => {
      const rect = entries.at(-1)?.contentRect
      if (!rect) return
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      adjacentRenderGenerationRef.current += 1
      releaseCachedPageRenders(adjacentPageCacheRef.current)
      renderEnvironmentKeyRef.current = ''
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        void renderPage(currentPage, pdfDocument).catch(
          async (error: unknown) => {
            if (!active) return
            if (await retryPrivatePdfDelivery(error, currentPage)) return
            if (!active) return
            setErrorMessage('PDFページの描画に失敗しました。')
          },
        )
      })
    })
    observer.observe(stage)
    return () => {
      active = false
      observer.disconnect()
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [currentPage, pdfDocument, renderPage, retryPrivatePdfDelivery])

  useEffect(() => {
    if (!pdfDocument) return
    let active = true
    let frameId: number | null = null
    let resolutionQuery: MediaQueryList | null = null

    const renderForDisplayEnvironment = () => {
      adjacentRenderGenerationRef.current += 1
      releaseCachedPageRenders(adjacentPageCacheRef.current)
      renderEnvironmentKeyRef.current = ''
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        void renderPage(currentPage, pdfDocument).catch(
          async (error: unknown) => {
            if (!active) return
            if (await retryPrivatePdfDelivery(error, currentPage)) return
            if (!active) return
            setErrorMessage('PDFページの描画に失敗しました。')
          },
        )
      })
    }
    const watchDevicePixelRatio = () => {
      resolutionQuery?.removeEventListener('change', handleResolutionChange)
      resolutionQuery = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      )
      resolutionQuery.addEventListener('change', handleResolutionChange)
    }
    const handleResolutionChange = () => {
      watchDevicePixelRatio()
      renderForDisplayEnvironment()
    }

    watchDevicePixelRatio()
    window.addEventListener('resize', renderForDisplayEnvironment)
    window.visualViewport?.addEventListener(
      'resize',
      renderForDisplayEnvironment,
    )
    return () => {
      active = false
      resolutionQuery?.removeEventListener('change', handleResolutionChange)
      window.removeEventListener('resize', renderForDisplayEnvironment)
      window.visualViewport?.removeEventListener(
        'resize',
        renderForDisplayEnvironment,
      )
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [currentPage, pdfDocument, renderPage, retryPrivatePdfDelivery])

  async function resumePresenterFollow() {
    setFollowPresenter(true)
    if (remotePage) {
      await moveToPage(remotePage)
    }
  }

  async function downloadPdf() {
    try {
      if (archiveSession) {
        const url = await archiveClient.getDocumentAccessUrl(
          archiveSession,
          'download',
        )
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.rel = 'noopener'
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
        return
      }
      const resolver = runtimeResolverRef.current
      if (!resolver) return
      const url = await resolver.getAccessUrl('download')
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.rel = 'noopener'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
    } catch {
      setErrorMessage('PDFのダウンロードに失敗しました。')
    }
  }

  return (
    <div
      className={`local-pdf-viewer synced-pdf-viewer ${
        projector ? 'is-projector' : ''
      }`}
    >
      {!projector ? (
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
                {isLiveView ? (
                  <span className="presenter-sync-badge">
                    <i /> 教員同期
                  </span>
                ) : null}
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
          {!presenterLocked && isLiveView ? (
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
          {(archivedPdf?.downloadEnabled ??
          runtimeDocument?.downloadEnabled) ? (
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
      ) : null}

      {!projector && !presenterLocked && isLiveView && pdfDocument ? (
        <p className="note">
          {followPresenter
            ? '教員がページを進めると、自動で同じページに移動します。'
            : 'いまは自分のペースで資料を見ています。'}
        </p>
      ) : null}
      {expectedPageCount && expectedPageCount !== totalPages && pdfDocument ? (
        <p className="error-note">資料情報を更新できませんでした。</p>
      ) : null}
      {!legacyAsset &&
      !useArchiveDelivery &&
      !usePrivateDelivery &&
      documentId ? (
        <p className="error-note">指定されたPDF資料が見つかりません。</p>
      ) : null}
      {errorMessage ? <p className="error-note">{errorMessage}</p> : null}
      {errorMessage && (useArchiveDelivery || usePrivateDelivery) ? (
        <button
          className="secondary-button"
          onClick={() => {
            privateDeliveryRetryCountRef.current = 0
            privateDeliveryRetryPageRef.current = currentPage
            setResolveAttempt((attempt) => attempt + 1)
          }}
          type="button"
        >
          PDFを再試行
        </button>
      ) : null}
      {!projector && fullscreenErrorMessage ? (
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
            <h2>
              {assetTitle
                ? '資料を開いています'
                : isLiveView
                  ? '教員からの資料を待っています'
                  : '講義資料は公開されていません'}
            </h2>
            <p>
              {isLiveView
                ? '資料が共有されると、この画面に自動で表示されます。'
                : '閲覧できる資料はありません。'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
