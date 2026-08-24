import { useEffect, useState } from 'react'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import {
  type AdminLecture,
  supabaseAdminRepository,
} from '../../repositories/supabaseAdminRepository'
import { isPhase728DisplayRealtimeEnabled } from '../../lib/featureFlags'

type Options = {
  activeAdminLecture: AdminLecture | undefined
  activeLectureSessionId: string | null
  adminToken: AdminOperationCredentialInput
}

const DISPLAY_LAUNCH_CACHE_KEY = 'compass-admin-display-launch-v1'

type CachedDisplayLaunch = {
  expiresAt: string
  lectureSessionId: string
  realtime: { expiresAt: string; topic: string } | null
  url: string
}

function readCachedDisplayLaunch(lectureSessionId: string | null) {
  if (!lectureSessionId || typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(DISPLAY_LAUNCH_CACHE_KEY) ?? 'null',
    ) as CachedDisplayLaunch | null
    if (
      !parsed ||
      parsed.lectureSessionId !== lectureSessionId ||
      Date.parse(parsed.expiresAt) <= Date.now() + 30_000
    ) {
      return null
    }
    const url = new URL(parsed.url)
    if (url.origin !== window.location.origin || url.pathname !== '/display') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function storeCachedDisplayLaunch(launch: CachedDisplayLaunch | null) {
  try {
    if (launch) {
      window.sessionStorage.setItem(
        DISPLAY_LAUNCH_CACHE_KEY,
        JSON.stringify(launch),
      )
    } else {
      window.sessionStorage.removeItem(DISPLAY_LAUNCH_CACHE_KEY)
    }
  } catch {
    // The server remains authoritative; blocked tab storage only disables reuse.
  }
}

async function copyDisplayUrl(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return
  } catch {
    const input = document.createElement('textarea')
    input.value = value
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.append(input)
    input.select()
    const copied = document.execCommand('copy')
    input.remove()
    if (!copied) throw new Error('Clipboard access is unavailable.')
  }
}

export function useAdminDisplayLauncher({
  activeAdminLecture,
  activeLectureSessionId,
  adminToken,
}: Options) {
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [isOpening, setIsOpening] = useState(false)
  const [instructionsVisible, setInstructionsVisible] = useState(false)
  const [preparedLaunch, setPreparedLaunch] =
    useState<CachedDisplayLaunch | null>(() =>
      readCachedDisplayLaunch(activeLectureSessionId),
    )

  useEffect(() => {
    const cached = readCachedDisplayLaunch(activeLectureSessionId)
    setPreparedLaunch(cached)
    setInstructionsVisible(Boolean(cached))
  }, [activeLectureSessionId])

  useEffect(() => {
    if (activeAdminLecture && activeAdminLecture.status !== 'open') {
      setPreparedLaunch(null)
      setInstructionsVisible(false)
      storeCachedDisplayLaunch(null)
    }
  }, [activeAdminLecture])

  function canIssue() {
    if (
      !adminToken ||
      !activeLectureSessionId ||
      activeAdminLecture?.status !== 'open'
    ) {
      setError('開始中の講義を選択してください。')
      return false
    }
    return true
  }

  async function issueDisplayUrl(): Promise<CachedDisplayLaunch> {
    if (!activeLectureSessionId || !activeAdminLecture) {
      throw new Error('開始中の講義を選択してください。')
    }
    const session = await supabaseAdminRepository.issueDisplaySession({
      adminToken,
      enableRealtime: isPhase728DisplayRealtimeEnabled,
      lectureSessionId: activeLectureSessionId,
    })
    const fragment = new URLSearchParams({
      code: activeAdminLecture.lectureCode,
      lecture: session.lectureSessionId,
      token: session.displayToken,
    })
    const launch = {
      expiresAt: session.expiresAt,
      lectureSessionId: session.lectureSessionId,
      realtime: session.realtime,
      url: new URL(
        `/display#${fragment.toString()}`,
        window.location.origin,
      ).toString(),
    }
    setPreparedLaunch(launch)
    storeCachedDisplayLaunch(launch)
    return launch
  }

  async function ensureDisplayLaunch() {
    const cached =
      preparedLaunch?.lectureSessionId === activeLectureSessionId &&
      Date.parse(preparedLaunch.expiresAt) > Date.now() + 30_000
        ? preparedLaunch
        : readCachedDisplayLaunch(activeLectureSessionId)
    if (cached) {
      setPreparedLaunch(cached)
      return cached
    }
    return issueDisplayUrl()
  }

  async function open() {
    if (!canIssue()) return

    setIsOpening(true)
    setCopied(false)
    setError(null)
    try {
      await ensureDisplayLaunch()
      setInstructionsVisible(true)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `共有画面を準備できませんでした: ${cause.message}`
          : '共有画面を準備できませんでした。',
      )
    } finally {
      setIsOpening(false)
    }
  }

  async function copyLink() {
    if (!canIssue()) return
    setIsCopying(true)
    setCopied(false)
    setError(null)
    try {
      const displayLaunch = await ensureDisplayLaunch()
      await copyDisplayUrl(displayLaunch.url)
      setCopied(true)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `共有URLをコピーできませんでした: ${cause.message}`
          : '共有URLをコピーできませんでした。',
      )
    } finally {
      setIsCopying(false)
    }
  }

  async function replaceLink() {
    if (!canIssue()) return
    setIsOpening(true)
    setCopied(false)
    setError(null)
    try {
      await issueDisplayUrl()
      setInstructionsVisible(true)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `新しい共有URLを発行できませんでした: ${cause.message}`
          : '新しい共有URLを発行できませんでした。',
      )
    } finally {
      setIsOpening(false)
    }
  }

  return {
    copied,
    copyLink,
    error,
    instructionsVisible,
    isCopying,
    isOpening,
    open,
    replaceLink,
  }
}
