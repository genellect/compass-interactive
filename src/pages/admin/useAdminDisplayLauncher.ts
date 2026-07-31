import { useState } from 'react'
import {
  type AdminLecture,
  supabaseAdminRepository,
} from '../../repositories/supabaseAdminRepository'
import { registerAdminDisplayRealtimeSession } from '../../display/displayRealtime'
import { isPhase728DisplayRealtimeEnabled } from '../../lib/featureFlags'

type Options = {
  activeAdminLecture: AdminLecture | undefined
  activeLectureSessionId: string | null
  adminToken: string
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

  async function issueDisplayUrl() {
    if (!activeLectureSessionId || !activeAdminLecture) {
      throw new Error('開始中の講義を選択してください。')
    }
    const session = await supabaseAdminRepository.issueDisplaySession({
      adminToken,
      enableRealtime: isPhase728DisplayRealtimeEnabled,
      lectureSessionId: activeLectureSessionId,
    })
    if (isPhase728DisplayRealtimeEnabled && !session.realtime) {
      throw new Error('Display Realtime could not be prepared.')
    }
    if (session.realtime) {
      registerAdminDisplayRealtimeSession({
        expiresAt: session.realtime.expiresAt,
        lectureSessionId: session.lectureSessionId,
        topic: session.realtime.topic,
      })
    }
    const fragment = new URLSearchParams({
      code: activeAdminLecture.lectureCode,
      lecture: session.lectureSessionId,
      token: session.displayToken,
    })
    return new URL(
      `/display#${fragment.toString()}`,
      window.location.origin,
    ).toString()
  }

  async function open() {
    if (!canIssue()) return

    const displayWindow = window.open('', '_blank')
    if (!displayWindow) {
      setError(
        '共有画面を開けませんでした。ポップアップを許可して再度お試しください。',
      )
      return
    }
    displayWindow.opener = null
    displayWindow.document.title = 'COMPASS 共有画面を準備中'
    displayWindow.document.body.textContent = '共有画面を準備しています…'

    setIsOpening(true)
    setCopied(false)
    setError(null)
    try {
      displayWindow.location.replace(await issueDisplayUrl())
    } catch (cause) {
      displayWindow.close()
      setError(
        cause instanceof Error
          ? `共有画面を開けませんでした: ${cause.message}`
          : '共有画面を開けませんでした。',
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
      const displayUrl = await issueDisplayUrl()
      await copyDisplayUrl(displayUrl)
      setCopied(true)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `別ブラウザ用リンクをコピーできませんでした: ${cause.message}`
          : '別ブラウザ用リンクをコピーできませんでした。',
      )
    } finally {
      setIsCopying(false)
    }
  }

  return { copied, copyLink, error, isCopying, isOpening, open }
}
