import { useEffect, useRef } from 'react'

export function useAdminPollAutoRefresh(input: {
  enabled: boolean
  refresh: () => void | Promise<unknown>
  refreshKey: string
}) {
  const refreshRef = useRef(input.refresh)
  refreshRef.current = input.refresh

  useEffect(() => {
    if (!input.enabled) return

    void refreshRef.current()
    const timer = window.setInterval(() => {
      void refreshRef.current()
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [input.enabled, input.refreshKey])
}
