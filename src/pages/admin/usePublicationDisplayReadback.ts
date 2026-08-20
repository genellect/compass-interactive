import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { BrowserPdfPublicationActivation } from '../../pdf/browserPdfPublicationClient'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'

type PendingPublicationDisplay = BrowserPdfPublicationActivation & {
  lectureSessionId: string
}

function matchesPublication(
  display: DisplayState | null,
  pending: PendingPublicationDisplay,
) {
  return (
    display?.lectureSessionId === pending.lectureSessionId &&
    display.pdfDocumentId === pending.documentId &&
    display.pdfDocumentVersion === pending.documentVersion &&
    display.pdfManifestVersion === pending.manifestVersion &&
    display.pdfVisible
  )
}

export function usePublicationDisplayReadback({
  activeLectureSessionId,
  liveDisplayState,
  refreshDisplayState,
  refreshLectures,
  setPublisherMessage,
}: {
  activeLectureSessionId: string | null
  liveDisplayState: DisplayState | null
  refreshDisplayState: () => Promise<DisplayState | null>
  refreshLectures: () => Promise<void>
  setPublisherMessage: Dispatch<SetStateAction<string>>
}) {
  const [pending, setPending] = useState<PendingPublicationDisplay | null>(null)
  const onPublicationActivated = useCallback(
    (lectureSessionId: string, activation: BrowserPdfPublicationActivation) =>
      setPending({ ...activation, lectureSessionId }),
    [],
  )

  useEffect(() => {
    if (!pending || pending.lectureSessionId !== activeLectureSessionId) return
    if (!matchesPublication(liveDisplayState, pending)) return
    setPending(null)
    setPublisherMessage('資料の表示状態を再同期しました。')
  }, [activeLectureSessionId, liveDisplayState, pending, setPublisherMessage])

  useEffect(() => {
    if (!pending || pending.lectureSessionId !== activeLectureSessionId) return
    let active = true
    void (async () => {
      for (const retryDelayMs of [0, 250, 1_000]) {
        if (retryDelayMs > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, retryDelayMs)
          })
        }
        if (!active) return
        try {
          const refreshed = await refreshDisplayState()
          if (matchesPublication(refreshed, pending)) {
            if (active) setPending(null)
            return
          }
        } catch {
          // Activation is authoritative. Retry only its display readback.
        }
      }
      if (active) {
        setPublisherMessage(
          '資料は公開済みです。表示状態の同期に時間がかかっています。「再読み込み」で再同期できます。',
        )
      }
    })()

    return () => {
      active = false
    }
  }, [
    activeLectureSessionId,
    pending,
    refreshDisplayState,
    setPublisherMessage,
  ])

  async function refreshAdminWorkspace() {
    const [, displayResult] = await Promise.allSettled([
      refreshLectures(),
      activeLectureSessionId ? refreshDisplayState() : Promise.resolve(null),
    ])
    if (
      pending &&
      displayResult.status === 'fulfilled' &&
      matchesPublication(displayResult.value, pending)
    ) {
      setPending(null)
      setPublisherMessage('資料の表示状態を再同期しました。')
    }
  }

  return { onPublicationActivated, refreshAdminWorkspace }
}
