import {
  restoreJoinedLectureSession,
  type JoinedLectureSession,
} from '../../lib/joinedLecture'
import type { CompassStateValue } from '../CompassStateValue'

export function getInitialJoinedLectureSession(): JoinedLectureSession | null {
  return restoreJoinedLectureSession()
}

export function getSessionPauseMessage(
  reason: CompassStateValue['sessionSyncPauseReason'],
) {
  if (reason === 'lectureClosed') {
    return '講義は終了しました。コメント投稿、共感、投票は停止しています。'
  }
  if (reason === 'idle')
    return '一定時間操作がなかったため、同期を停止しました。'
  if (reason === 'hidden') {
    return '長時間バックグラウンドだったため、同期を停止しました。'
  }
  return null
}

export function deriveLiveSessionCapabilities({
  hasActiveLectureSessionId,
  hasRequiredOperatorAccess,
  isLectureOpen,
  isLiveSyncRoute,
  isSessionSyncPaused,
  runtimeMode,
}: {
  hasActiveLectureSessionId: boolean
  hasRequiredOperatorAccess: boolean
  isLectureOpen: boolean
  isLiveSyncRoute: boolean
  isSessionSyncPaused: boolean
  runtimeMode: 'demo' | 'live'
}) {
  const canRunLiveSync =
    runtimeMode === 'live' &&
    hasActiveLectureSessionId &&
    isLectureOpen &&
    isLiveSyncRoute &&
    hasRequiredOperatorAccess &&
    !isSessionSyncPaused

  return {
    canInteract:
      runtimeMode === 'demo'
        ? hasActiveLectureSessionId && isLectureOpen
        : canRunLiveSync,
    canRunLiveSync,
  }
}
