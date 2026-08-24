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
  const [consumeBusy, setConsumeBusy] = useState(false)
  const [consumeRetryVersion, setConsumeRetryVersion] = useState(0)
  const [message, setMessage] = useState('')
  const [activationIntent, setActivationIntentState] = useState(false)
  const statusRequestVersionRef = useRef(0)
  const automaticAttemptRef = useRef<string | null>(null)
  const consumeAttemptCountRef = useRef(0)
  const consumeInFlightRef = useRef(false)
  const consumeOperationRef = useRef(0)
  const activationIntentRef = useRef(false)
  const activationIntentVersionRef = useRef(0)
  const activationIntentLectureRef = useRef(lectureSessionId)
  const activationHandoffLectureRef = useRef<string | null>(null)
  const activationHandoffVersionRef = useRef<number | null>(null)
  const lectureSessionIdRef = useRef(lectureSessionId)
  lectureSessionIdRef.current = lectureSessionId
  if (activationIntentLectureRef.current !== lectureSessionId) {
    activationIntentLectureRef.current = lectureSessionId
    activationIntentRef.current = false
    activationIntentVersionRef.current = 0
    activationHandoffLectureRef.current = null
    activationHandoffVersionRef.current = null
  }

  const updateActivationIntent = useCallback(
    async (enabled: boolean) => {
      if (busy) return
      const targetLectureSessionId = lectureSessionId
      setBusy(true)
      try {
        const intent = await supabaseAdminRepository.setAiActivationIntent({
          adminToken,
          enabled,
          lectureSessionId: targetLectureSessionId,
        })
        if (lectureSessionIdRef.current !== targetLectureSessionId) return
        activationIntentRef.current = intent.armed
        activationIntentVersionRef.current = intent.version
        setActivationIntentState(intent.armed)
        consumeAttemptCountRef.current = 0
        setMessage(
          intent.armed
            ? '講義を開始するとAI機能を有効にします。開始前にAPIは呼び出されません。'
            : '講義開始時のAI有効化を取り消しました。',
        )
      } catch (error) {
        if (lectureSessionIdRef.current !== targetLectureSessionId) return
        setMessage(
          error instanceof Error
            ? error.message
            : '講義開始時のAI有効化を変更できませんでした。',
        )
      } finally {
        if (lectureSessionIdRef.current === targetLectureSessionId) {
          setBusy(false)
        }
      }
    },
    [adminToken, busy, lectureSessionId],
  )

  const applyAuthorization = useCallback(
    (next: AiMasterAuthorization | null) => {
      setAuthorization(next)
      onAuthorizationChange(next?.status === 'active' ? next : null)
    },
    [onAuthorizationChange],
  )

  const refresh = useCallback(async () => {
    const targetLectureSessionId = lectureSessionId
    const requestVersion = ++statusRequestVersionRef.current
    onReadinessChange('checking')
    try {
      const [status, intent] = await Promise.all([
        supabaseAdminRepository.getAiMasterAuthorization({
          adminToken,
          lectureSessionId: targetLectureSessionId,
        }),
        supabaseAdminRepository.getAiActivationIntent({
          adminToken,
          lectureSessionId: targetLectureSessionId,
        }),
      ])
      if (
        requestVersion === statusRequestVersionRef.current &&
        lectureSessionIdRef.current === targetLectureSessionId
      ) {
        activationIntentRef.current = intent.armed
        activationIntentVersionRef.current = intent.version
        setActivationIntentState(intent.armed)
        const activationExpiresAt =
          intent.activationExpiresAt === null
            ? Number.NaN
            : Date.parse(intent.activationExpiresAt)
        const intentServerTime = Date.parse(intent.serverTime)
        const hasLiveActivationHandoff =
          lectureStatus === 'open' &&
          status.lectureOpen &&
          intent.armed &&
          intent.state === 'armed' &&
          Number.isFinite(activationExpiresAt) &&
          Number.isFinite(intentServerTime) &&
          activationExpiresAt > intentServerTime
        if (hasLiveActivationHandoff) {
          activationHandoffLectureRef.current = targetLectureSessionId
          activationHandoffVersionRef.current = intent.version
        } else {
          activationHandoffLectureRef.current = null
          activationHandoffVersionRef.current = null
        }
        if (!intent.armed) consumeAttemptCountRef.current = 0
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
        if (
          lectureStatus !== 'draft' &&
          !status.authorization &&
          !status.admissionEnabled
        ) {
          setMessage(admissionBlockedMessage(status.admissionBlockedReason))
        } else if (status.reason === 'pre_c1_master_remediated') {
          setMessage(
            '以前の許可を安全に停止しました。AI機能を有効にし直してください。',
          )
        }
      }
    } catch (error) {
      if (
        requestVersion === statusRequestVersionRef.current &&
        lectureSessionIdRef.current === targetLectureSessionId
      ) {
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
  }, [
    adminToken,
    applyAuthorization,
    lectureSessionId,
    lectureStatus,
    onReadinessChange,
  ])

  useEffect(() => {
    setActivationIntentState(false)
    setBusy(false)
    automaticAttemptRef.current = null
    consumeAttemptCountRef.current = 0
    consumeInFlightRef.current = false
    consumeOperationRef.current += 1
    setConsumeBusy(false)
    applyAuthorization(null)
    setAdmissionEnabled(false)
    setAllowedScopes([])
    setServerLectureOpen(false)
    onReadinessChange('checking')
    setMessage('')
    void refresh()
  }, [applyAuthorization, lectureSessionId, onReadinessChange, refresh])

  useEffect(() => {
    if (lectureStatus !== 'open') {
      activationHandoffLectureRef.current = null
      activationHandoffVersionRef.current = null
    }
    if (lectureStatus === 'open') {
      void refresh()
      return
    }
    if (lectureStatus === 'closed') {
      activationIntentRef.current = false
      activationIntentVersionRef.current = 0
      setActivationIntentState(false)
    }
    automaticAttemptRef.current = null
    consumeAttemptCountRef.current = 0
    applyAuthorization(null)
    onReadinessChange('blocked')
  }, [
    applyAuthorization,
    lectureSessionId,
    lectureStatus,
    onReadinessChange,
    refresh,
  ])

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

  const authorize = useCallback(
    async (activationIntentVersion?: number) => {
      const targetLectureSessionId = lectureSessionId
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
            activationIntentVersion,
            adminToken,
            lectureSessionId: targetLectureSessionId,
            masterScope: scope,
          })
        if (lectureSessionIdRef.current !== targetLectureSessionId) return
        statusRequestVersionRef.current += 1
        applyAuthorization(status.authorization)
        if (activationIntentVersion !== undefined) {
          activationIntentRef.current = false
          setActivationIntentState(false)
          activationHandoffLectureRef.current = null
          activationHandoffVersionRef.current = null
        }
        onReadinessChange('ready')
        setMessage(
          scope === 'all_including_captions'
            ? 'すべてのAI機能を講義終了まで許可しました。字幕と各AI機能は個別に開始します。'
            : '字幕以外のAI機能を講義終了まで許可しました。各AI機能は個別に開始します。',
        )
      } catch (error) {
        if (lectureSessionIdRef.current !== targetLectureSessionId) return
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
        if (lectureSessionIdRef.current === targetLectureSessionId) {
          setBusy(false)
        }
      }
    },
    [
      adminToken,
      admissionEnabled,
      allowedScopes,
      applyAuthorization,
      busy,
      lectureSessionId,
      lectureStatus,
      onReadinessChange,
      serverLectureOpen,
    ],
  )

  const consumeActivationIntent = useCallback(async () => {
    if (consumeInFlightRef.current) return
    const targetLectureSessionId = lectureSessionId
    const operationId = consumeOperationRef.current + 1
    consumeOperationRef.current = operationId
    consumeInFlightRef.current = true
    consumeAttemptCountRef.current += 1
    setConsumeBusy(true)
    let shouldRetry = false
    try {
      const intent = await supabaseAdminRepository.consumeAiActivationIntent({
        adminToken,
        lectureSessionId: targetLectureSessionId,
      })
      if (lectureSessionIdRef.current !== targetLectureSessionId) return
      activationIntentRef.current = intent.armed
      activationIntentVersionRef.current = intent.version
      setActivationIntentState(intent.armed)
      if (!intent.armed) {
        activationHandoffLectureRef.current = null
        activationHandoffVersionRef.current = null
        consumeAttemptCountRef.current = 0
        setMessage(
          'AI機能の許可と講義開始時の有効化予約を確認しました。各AI機能は個別に開始します。',
        )
      }
    } catch {
      if (lectureSessionIdRef.current !== targetLectureSessionId) return
      shouldRetry = consumeAttemptCountRef.current < 3
      setMessage(
        shouldRetry
          ? 'AI機能は許可済みです。有効化予約の完了確認だけを自動で再試行します。'
          : 'AI機能は許可済みですが、有効化予約の完了を確認できませんでした。「予約の完了を再確認」を押してください。',
      )
    } finally {
      if (
        consumeOperationRef.current === operationId &&
        lectureSessionIdRef.current === targetLectureSessionId
      ) {
        consumeInFlightRef.current = false
        setConsumeBusy(false)
        if (shouldRetry) setConsumeRetryVersion((version) => version + 1)
      }
    }
  }, [adminToken, lectureSessionId])

  useEffect(() => {
    if (
      !activationIntent ||
      lectureStatus !== 'open' ||
      activationHandoffLectureRef.current !== lectureSessionId ||
      !serverLectureOpen ||
      !admissionEnabled ||
      allowedScopes.length === 0 ||
      busy
    ) {
      return
    }
    const automaticAttemptKey = `${lectureSessionId}:${lectureStatus}`
    if (automaticAttemptRef.current === automaticAttemptKey) return
    const activationIntentVersion = activationHandoffVersionRef.current
    if (!activationIntentVersion) return
    automaticAttemptRef.current = automaticAttemptKey
    void authorize(activationIntentVersion)
  }, [
    activationIntent,
    admissionEnabled,
    allowedScopes.length,
    authorize,
    busy,
    consumeRetryVersion,
    lectureSessionId,
    lectureStatus,
    serverLectureOpen,
  ])

  useEffect(() => {
    if (
      !activationIntent ||
      lectureStatus !== 'open' ||
      authorization?.status !== 'active' ||
      !authorization.ownedByRequester ||
      (activationHandoffLectureRef.current === lectureSessionId &&
        activationHandoffVersionRef.current !== null) ||
      busy ||
      consumeBusy ||
      consumeAttemptCountRef.current >= 3
    ) {
      return
    }
    const retryDelayMs = [0, 1_000, 3_000][consumeAttemptCountRef.current]
    const timer = window.setTimeout(
      () => void consumeActivationIntent(),
      retryDelayMs,
    )
    return () => window.clearTimeout(timer)
  }, [
    activationIntent,
    authorization?.id,
    authorization?.ownedByRequester,
    authorization?.status,
    busy,
    consumeActivationIntent,
    consumeBusy,
    consumeRetryVersion,
    lectureSessionId,
    lectureStatus,
  ])

  async function revoke() {
    if (busy || authorization?.status !== 'active') return
    const targetLectureSessionId = lectureSessionId
    statusRequestVersionRef.current += 1
    setBusy(true)
    setMessage('AI機能を停止しています…')
    let intentCancelConfirmed = false
    try {
      try {
        const intent = await supabaseAdminRepository.setAiActivationIntent({
          adminToken,
          enabled: false,
          lectureSessionId: targetLectureSessionId,
        })
        if (lectureSessionIdRef.current !== targetLectureSessionId) return
        activationIntentRef.current = intent.armed
        activationIntentVersionRef.current = intent.version
        setActivationIntentState(intent.armed)
        intentCancelConfirmed = !intent.armed
      } catch {
        activationIntentRef.current = false
        setActivationIntentState(false)
      }
      activationHandoffLectureRef.current = null
      activationHandoffVersionRef.current = null
      await supabaseAdminRepository.revokeAiMasterAuthorization({
        adminToken,
        lectureSessionId: targetLectureSessionId,
        reason: 'admin_manual_revoke',
      })
      if (lectureSessionIdRef.current !== targetLectureSessionId) return
      statusRequestVersionRef.current += 1
      applyAuthorization(null)
      setMessage(
        intentCancelConfirmed
          ? 'AI機能を停止しました。'
          : 'AI機能を停止しました。開始時予約の状態は次回の手動有効化時に再確認します。',
      )
    } catch (error) {
      if (lectureSessionIdRef.current !== targetLectureSessionId) return
      setMessage(
        error instanceof Error
          ? error.message
          : 'AI機能を停止できませんでした。',
      )
    } finally {
      if (lectureSessionIdRef.current === targetLectureSessionId) {
        setBusy(false)
      }
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
          {lectureStatus === 'open' ? (
            <button
              className="primary-button"
              disabled={busy || !canAdmit || !hasAllowedScope}
              onClick={() => void authorize()}
              type="button"
            >
              AI機能を有効にする
            </button>
          ) : lectureStatus === 'draft' ? (
            <button
              aria-pressed={activationIntent}
              className={
                activationIntent ? 'secondary-button' : 'primary-button'
              }
              disabled={busy}
              onClick={() => {
                void updateActivationIntent(!activationIntent)
              }}
              type="button"
            >
              {activationIntent
                ? '講義開始時のAI有効化を取り消す'
                : '講義開始時にAI機能を有効にする'}
            </button>
          ) : null}
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
          {active && activationIntent ? (
            <button
              className="secondary-button"
              disabled={busy || consumeBusy}
              onClick={() => {
                consumeAttemptCountRef.current = 0
                setConsumeRetryVersion((version) => version + 1)
              }}
              type="button"
            >
              予約の完了を再確認
            </button>
          ) : null}
          <button
            className="secondary-button"
            disabled={busy || consumeBusy}
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
