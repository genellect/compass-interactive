import { useState } from 'react'
import {
  type AdminLecture,
  supabaseAdminRepository,
} from '../../repositories/supabaseAdminRepository'

type Options = {
  activeAdminLecture: AdminLecture | undefined
  activeLectureSessionId: string | null
  adminToken: string
}

export function useAdminDisplayLauncher({
  activeAdminLecture,
  activeLectureSessionId,
  adminToken,
}: Options) {
  const [error, setError] = useState<string | null>(null)
  const [isOpening, setIsOpening] = useState(false)

  async function open() {
    if (
      !adminToken ||
      !activeLectureSessionId ||
      activeAdminLecture?.status !== 'open'
    ) {
      setError('開始中の講義を選択してください。')
      return
    }

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
    setError(null)
    try {
      const session = await supabaseAdminRepository.issueDisplaySession({
        adminToken,
        lectureSessionId: activeLectureSessionId,
      })
      const fragment = new URLSearchParams({
        code: activeAdminLecture.lectureCode,
        lecture: session.lectureSessionId,
        token: session.displayToken,
      })
      displayWindow.location.replace(`/display#${fragment.toString()}`)
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

  return { error, isOpening, open }
}
