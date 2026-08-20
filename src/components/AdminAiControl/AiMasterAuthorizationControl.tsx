import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import { AdminAiUnlockError } from '../../lib/adminAuth/adminAiUnlockApi'
import type { RememberedBrowserIdentityScope } from '../../lib/adminAuth/rememberedBrowserCredential'

import type {
  AiMasterAuthorization,
  AiMasterAuthorizationScope,
} from '../../repositories/supabaseAdminRepository'
import { supabaseAdminRepository } from '../../repositories/supabaseAdminRepository'

type Props = {
  adminToken: AdminOperationCredentialInput
  identityScope: RememberedBrowserIdentityScope
  lectureSessionId: string
  lectureStatus: string
  onAuthorizationChange: (authorization: AiMasterAuthorization | null) => void
  onReadinessChange: (readiness: AiMasterReadiness) => void
}

export type AiMasterReadiness = 'checking' | 'ready' | 'blocked'

function admissionBlockedMessage(reason: string | null) {
  if (reason === 'membership_ai_disabled') {
    return 'この管理者にはAI機能の利用権限がありません。状態確認と停止は利用できます。'
  }
  if (reason === 'lecture_not_open') {
    return '開始済みで終了前の講義だけAI機能を新しく許可できます。'
  }
  if (
    reason === 'policy_unavailable' ||
    reason === 'policy_scope_unavailable'
  ) {
    return 'この講義で利用できるAI機能の組み合わせがありません。'
  }
  return 'AI機能の新しい許可は現在停止中です。状態確認と停止は利用できます。'
}

export function AiMasterAuthorizationControl({
  adminToken,
  lectureSessionId,
  lectureStatus,
  onAuthorizationChange,
  onReadinessChange,
}: Props) {
  const [authorization, setAuthorization] =
    useState<AiMasterAuthorization | null>(null)
  const [admissionEnabled, setAdmissionEnabled] = useState(false)
  const [allowedScopes, setAllowedScopes] = useState<
    AiMasterAuthorizationScope[]
  >([])
  const [serverLectureOpen, setServerLectureOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const statusRequestVersionRef = useRef(0)

  const applyAuthorization = useCallback(
    (next: AiMasterAuthorization | null) => {
      setAuthorization(next)
      onAuthorizationChange(next?.status === 'active' ? next : null)
    },
    [onAuthorizationChange],
  )

  const refresh = useCallback(async () => {
    const requestVersion = ++statusRequestVersionRef.current
    onReadinessChange('checking')
    try {
      const status = await supabaseAdminRepository.getAiMasterAuthorization({
        adminToken,
        lectureSessionId,
      })
      if (requestVersion === statusRequestVersionRef.current) {
        applyAuthorization(status.authorization)
        setAdmissionEnabled(status.admissionEnabled)
        setAllowedScopes(status.allowedScopes)
        setServerLectureOpen(status.lectureOpen)
        const activeAuthorization = status.authorization?.status === 'active'
        const admissionReady =
          status.admissionEnabled &&
          status.lectureOpen &&
          status.allowedScopes.length > 0
        onReadinessChange(
          activeAuthorization || admissionReady ? 'ready' : 'blocked',
        )
        setMessage('')
        if (!status.authorization && !status.admissionEnabled) {
          setMessage(admissionBlockedMessage(status.admissionBlockedReason))
        } else if (status.reason === 'pre_c1_master_remediated') {
          setMessage(
            '以前の許可を安全に停止しました。AI機能を有効にし直してください。',
          )
        }
      }
    } catch (error) {
      if (requestVersion === statusRequestVersionRef.current) {
        applyAuthorization(null)
        setAdmissionEnabled(false)
        setAllowedScopes([])
        setServerLectureOpen(false)
        onReadinessChange('blocked')
        setMessage(
          error instanceof Error
            ? error.message
            : 'AI機能の許可状態を確認できませんでした。',
        )
      }
    }
  }, [adminToken, applyAuthorization, lectureSessionId, onReadinessChange])

  useEffect(() => {
    applyAuthorization(null)
    setAdmissionEnabled(false)
    setAllowedScopes([])
    setServerLectureOpen(false)
    onReadinessChange('checking')
    setMessage('')
    void refresh()
  }, [applyAuthorization, onReadinessChange, refresh])

  useEffect(() => {
    if (lectureStatus === 'open') {
      void refresh()
      return
    }
    applyAuthorization(null)
    onReadinessChange('blocked')
  }, [applyAuthorization, lectureStatus, onReadinessChange, refresh])

  useEffect(() => {
    if (lectureStatus !== 'open') return
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const timer = window.setInterval(() => void refresh(), 10_000)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [lectureStatus, refresh])

  async function authorize() {
    const scope: AiMasterAuthorizationScope | null = allowedScopes.includes(
      'all_including_captions',
    )
      ? 'all_including_captions'
      : allowedScopes.includes('all_except_captions')
        ? 'all_except_captions'
        : null
    if (
      !scope ||
      lectureStatus !== 'open' ||
      !serverLectureOpen ||
      !admissionEnabled ||
      !allowedScopes.includes(scope) ||
      busy
    )
      return
    statusRequestVersionRef.current += 1
    setBusy(true)
    setMessage('講義状態とAI利用権限を確認しています…')
    try {
      const status =
        await supabaseAdminRepository.authorizeAiMasterWithAal2Session({
          adminToken,
          lectureSessionId,
          masterScope: scope,
        })
      statusRequestVersionRef.current += 1
      applyAuthorization(status.authorization)
      onReadinessChange('ready')
      setMessage(
        scope === 'all_including_captions'
          ? 'すべてのAI機能を講義終了まで許可しました。字幕と各AI機能は個別に開始します。'
          : '字幕以外のAI機能を講義終了まで許可しました。各AI機能は個別に開始します。',
      )
    } catch (error) {
      const retryable =
        error instanceof AdminAiUnlockError && error.code === 'request_failed'
      setMessage(
        retryable
          ? '通信結果を確認できませんでした。同じ許可ボタンでもう一度確認できます。'
          : error instanceof Error
            ? error.message
            : '講義中のAI機能を許可できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (busy || authorization?.status !== 'active') return
    statusRequestVersionRef.current += 1
    setBusy(true)
    setMessage('AI機能を停止しています…')
    try {
      await supabaseAdminRepository.revokeAiMasterAuthorization({
        adminToken,
        lectureSessionId,
        reason: 'admin_manual_revoke',
      })
      statusRequestVersionRef.current += 1
      applyAuthorization(null)
      setMessage('AI機能を停止しました。')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'AI機能を停止できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  const active =
    authorization?.status === 'active' && authorization.ownedByRequester
  const heldByOther =
    authorization?.status === 'active' && !authorization.ownedByRequester
  const authorizationActive = active || heldByOther
  const allExceptCaptionsAllowed = allowedScopes.includes('all_except_captions')
  const allIncludingCaptionsAllowed = allowedScopes.includes(
    'all_including_captions',
  )
  const canAdmit =
    admissionEnabled && serverLectureOpen && lectureStatus === 'open'
  const hasAllowedScope =
    allExceptCaptionsAllowed || allIncludingCaptionsAllowed

  return (
    <section className="ai-master-authorization" data-testid="ai-master-auth">
      <div className="summary-control-heading">
        <div>
          <strong>講義中のAI機能</strong>
          <small>許可だけではAPIは呼び出されません</small>
        </div>
        <span className={`support-state ${active ? 'is-ready' : ''}`}>
          {active ? '許可済み' : heldByOther ? '別画面で許可中' : '未許可'}
        </span>
      </div>

      {!authorizationActive ? (
        <div className="summary-control-actions">
          <button
            className="primary-button"
            disabled={busy || !canAdmit || !hasAllowedScope}
            onClick={() => void authorize()}
            type="button"
          >
            AI機能を有効にする
          </button>
          {canAdmit &&
          allExceptCaptionsAllowed &&
          !allIncludingCaptionsAllowed ? (
            <span className="note">
              この講義では字幕を含む一括許可を利用できません。
            </span>
          ) : null}
        </div>
      ) : null}

      {authorizationActive ? (
        <div className="summary-control-actions">
          <span className="note">
            {heldByOther
              ? '同じ管理者の以前の画面で許可されています。停止後、この画面で許可し直せます。'
              : authorization.scope === 'all_including_captions'
                ? '字幕を含むすべてのAI機能'
                : '字幕以外のAI機能'}
          </span>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void revoke()}
            type="button"
          >
            すべて停止
          </button>
        </div>
      ) : null}

      {message ? (
        <p aria-live="polite" className="note">
          {message}
        </p>
      ) : null}
    </section>
  )
}
