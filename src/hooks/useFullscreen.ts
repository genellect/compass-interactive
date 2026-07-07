import { useCallback, useEffect, useState, type RefObject } from 'react'

type UseFullscreenResult = {
  errorMessage: string
  exitFullscreen: () => Promise<void>
  isFullscreen: boolean
  isFullscreenSupported: boolean
  requestFullscreen: () => Promise<void>
  toggleFullscreen: () => Promise<void>
}

export function useFullscreen<T extends HTMLElement>(
  targetRef: RefObject<T | null>,
): UseFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const isFullscreenSupported =
    typeof document !== 'undefined' && document.fullscreenEnabled

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === targetRef.current)
      setErrorMessage('')
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [targetRef])

  const requestFullscreen = useCallback(async () => {
    if (!targetRef.current || !isFullscreenSupported) {
      setErrorMessage('Fullscreen is not available in this browser.')
      return
    }

    try {
      await targetRef.current.requestFullscreen()
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? `Fullscreen failed: ${error.message}`
          : 'Fullscreen failed.',
      )
    }
  }, [isFullscreenSupported, targetRef])

  const exitFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      return
    }

    try {
      await document.exitFullscreen()
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? `Exit fullscreen failed: ${error.message}`
          : 'Exit fullscreen failed.',
      )
    }
  }, [])

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement === targetRef.current) {
      await exitFullscreen()
      return
    }

    await requestFullscreen()
  }, [exitFullscreen, requestFullscreen, targetRef])

  return {
    errorMessage,
    exitFullscreen,
    isFullscreen,
    isFullscreenSupported,
    requestFullscreen,
    toggleFullscreen,
  }
}
