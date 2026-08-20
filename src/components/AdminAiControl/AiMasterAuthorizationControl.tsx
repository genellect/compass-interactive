import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import { AdminAiUnlockError } from '../../lib/adminAuth/adminAiUnlockApi'
import {
  listRememberedBrowserCredentials,
  type RememberedBrowserIdentityScope,
} from '../../lib/adminAuth/rememberedBrowserCredential'

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
}

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
  identityScope,
  lectureSessionId,
  lectureStatus,
  onAuthorizationChange,
}: Props) {
  const [authorization, setAuthorization] =
    useState<AiMasterAuthorization | null>(null)
  const [aiPin, setAiPin] = useState('')
  const [admissionEnabled, setAdmissionEnabled] = useState(true)
  const [allowedScopes, setAllowedScopes] = useState<
    AiMasterAuthorizationScope[]
  >(['all_except_captions', 'all_including_captions'])
  const [serverLectureOpen, setServerLectureOpen] = useState(
    lectureStatus === 'open',
  )
  const [busy, setBusy] = useState(false)
  const [rememberedBrowserAvailable, setRememberedBrowserAvailable] =
    useState(false)
  const [rememberedBrowserFailed, setRememberedBrowserFailed] = useState(false)
  const [message, setMessage] = useState('')
  const statusRequestVersionRef = useRef(0)
  const pinReady = /^\d{4}$/.test(aiPin)

  const applyAuthorization = useCallback(
    (next: AiMasterAuthorization | null) => {
      setAuthorization(next)
      onAuthorizationChange(next?.status === 'active' ? next : null)
    },
    [onAuthorizationChange],
  )

  const refresh = useCallback(async () => {
    const requestVersion = ++statusRequestVersionRef.current
    try {
      const [status, rememberedBrowsers] = await Promise.all([
        supabaseAdminRepository.getAiMasterAuthorization({
          adminToken,
          lectureSessionId,
        }),
        listRememberedBrowserCredentials(identityScope).catch(() => []),
      ])
      if (requestVersion === statusRequestVersionRef.current) {
        applyAuthorization(status.authorization)
        setRememberedBrowserAvailable(rememberedBrowsers.length > 0)
        setAdmissionEnabled(status.admissionEnabled)
        setAllowedScopes(status.allowedScopes)
        setServerLectureOpen(status.lectureOpen)
        if (!status.authorization && !status.admissionEnabled) {
          setMessage(admissionBlockedMessage(status.admissionBlockedReason))
        } else if (status.reason === 'pre_c1_master_remediated') {
          setMessage(
            '以前の共有許可を安全に停止しました。個人AI PINで許可し直してください。',
          )
        }
      }
    } catch (error) {
      if (requestVersion === statusRequestVersionRef.current) {
        setMessage(
          error instanceof Error
            ? error.message
            : 'AI機能の許可状態を確認できませんでした。',
        )
      }
    }
  }, [adminToken, applyAuthorization, identityScope, lectureSessionId])

  useEffect(() => {
    applyAuthorization(null)
    setAiPin('')
    setMessage('')
    setRememberedBrowserFailed(false)
    void refresh()
  }, [applyAuthorization, refresh])

  useEffect(() => {
    if (lectureStatus === 'open') return
    applyAuthorization(null)
  }, [applyAuthorization, lectureStatus])

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

  async function authorize(scope: AiMasterAuthorizationScope) {
    const useRememberedBrowser =
      rememberedBrowserAvailable && !rememberedBrowserFailed
    if (
      (!useRememberedBrowser && !pinReady) ||
      lectureStatus !== 'open' ||
      !serverLectureOpen ||
      !admissionEnabled ||
      !allowedScopes.includes(scope) ||
      busy
    )
      return
    statusRequestVersionRef.current += 1
    setBusy(true)
    setMessage(
      useRememberedBrowser
        ? 'このブラウザの登録と講義状態を確認しています…'
        : '個人AI PINと講義状態を確認しています…',
    )
    try {
      const status = useRememberedBrowser
        ? await supabaseAdminRepository.authorizeAiMasterWithRememberedBrowser({
            adminToken,
            identityScope,
            lectureSessionId,
            masterScope: scope,
          })
        : await supabaseAdminRepository.authorizeAiMaster({
            adminToken,
            aiPin,
            lectureSessionId,
            masterScope: scope,
          })
      statusRequestVersionRef.current += 1
      applyAuthorization(status.authorization)
      setMessage(
        scope === 'all_including_captions'
          ? 'すべてのAI機能を講義終了まで許可しました。字幕と各AI機能は個別に開始します。'
          : '字幕以外のAI機能を講義終了まで許可しました。各AI機能は個別に開始します。',
      )
    } catch (error) {
      const rememberedBrowserRetryable =
        useRememberedBrowser &&
        error instanceof AdminAiUnlockError &&
        error.code === 'request_failed'
      if (useRememberedBrowser && !rememberedBrowserRetryable) {
        setRememberedBrowserFailed(true)
      }
      setMessage(
        rememberedBrowserRetryable
          ? '通信結果を確認できませんでした。同じ許可ボタンでもう一度確認できます。'
          : error instanceof Error
            ? `${error.message}${useRememberedBrowser ? ' AI PINでも続けられます。' : ''}`
            : '講義中のAI機能を許可できませんでした。',
      )
    } finally {
      setAiPin('')
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
      setMessage('AI機能を停止しました。停止に個人AI PINは不要です。')
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
          {rememberedBrowserAvailable && !rememberedBrowserFailed ? (
            <span className="note">
              登録済みのこのブラウザで許可します。PINや認証アプリの再入力は不要です。
            </span>
          ) : (
            <label className="field compact-field">
              <span>個人AI PIN</span>
              <input
                autoComplete="off"
                disabled={busy || !canAdmit}
                inputMode="numeric"
                maxLength={4}
                onChange={(event) => setAiPin(event.target.value)}
                type="password"
                value={aiPin}
              />
            </label>
          )}
          <button
            className="secondary-button"
            disabled={
              busy ||
              (!rememberedBrowserAvailable && !pinReady) ||
              (rememberedBrowserFailed && !pinReady) ||
              !canAdmit ||
              !allExceptCaptionsAllowed
            }
            onClick={() => void authorize('all_except_captions')}
            type="button"
          >
            字幕以外を許可
          </button>
          <button
            className="primary-button"
            disabled={
              busy ||
              (!rememberedBrowserAvailable && !pinReady) ||
              (rememberedBrowserFailed && !pinReady) ||
              !canAdmit ||
              !allIncludingCaptionsAllowed
            }
            onClick={() => void authorize('all_including_captions')}
            type="button"
          >
            字幕も含めて許可
          </button>
          {!allIncludingCaptionsAllowed ? (
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
