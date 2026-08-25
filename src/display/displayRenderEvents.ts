const DISPLAY_PDF_RENDERED_EVENT = 'compass:display-pdf-rendered'

export type DisplayPdfRenderedDetail = {
  documentId: string
  documentVersion: string
  lectureSessionId: string
  manifestVersion: number
  page: number
}

export function getDisplayPdfRenderKey(input: DisplayPdfRenderedDetail) {
  return [
    input.lectureSessionId,
    input.documentId,
    input.documentVersion,
    input.manifestVersion,
    input.page,
  ].join(':')
}

export function publishDisplayPdfRendered(detail: DisplayPdfRenderedDetail) {
  window.dispatchEvent(
    new CustomEvent<DisplayPdfRenderedDetail>(DISPLAY_PDF_RENDERED_EVENT, {
      detail,
    }),
  )
}

export function subscribeDisplayPdfRendered(
  listener: (detail: DisplayPdfRenderedDetail) => void,
) {
  const handleEvent = (event: Event) => {
    if (!(event instanceof CustomEvent)) return
    listener(event.detail as DisplayPdfRenderedDetail)
  }
  window.addEventListener(DISPLAY_PDF_RENDERED_EVENT, handleEvent)
  return () =>
    window.removeEventListener(DISPLAY_PDF_RENDERED_EVENT, handleEvent)
}
