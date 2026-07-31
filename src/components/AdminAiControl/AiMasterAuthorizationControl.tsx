import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  AiMasterAuthorization,
  AiMasterAuthorizationScope,
} from '../../repositories/supabaseAdminRepository'
import { supabaseAdminRepository } from '../../repositories/supabaseAdminRepository'

type Props = {
  adminToken: string
  lectureSessionId: string
  lectureStatus: string
  onAuthorizationChange: (authorization: AiMasterAuthorization | null) => void
}

export function AiMasterAuthorizationControl({
  adminToken,
  lectureSessionId,
  lectureStatus,
  onAuthorizationChange,
}: Props) {
  const [authorization, setAuthorization] =
    useState<AiMasterAuthorization | null>(null)
  const [billingPin, setBillingPin] = useState('')
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
    try {
      const status = await supabaseAdminRepository.getAiMasterAuthorization({
        adminToken,
        lectureSessionId,
      })
      if (requestVersion === statusRequestVersionRef.current) {
        applyAuthorization(status.authorization)
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
  }, [adminToken, applyAuthorization, lectureSessionId])

  useEffect(() => {
    applyAuthorization(null)
    setBillingPin('')
    setMessage('')
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
    if (!billingPin.trim() || lectureStatus !== 'open' || busy) return
    statusRequestVersionRef.current += 1
    setBusy(true)
    setMessage('API PINと講義状態を確認しています…')
    try {
      const status = await supabaseAdminRepository.authorizeAiMaster({
        adminToken,
        billingPin,
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
      setMessage(
        error instanceof Error
          ? error.message
          : '講義中のAI機能を許可できませんでした。',
      )
    } finally {
      setBillingPin('')
      setBusy(false)
    }
  }

  async function revoke() {
    if (busy || !authorization?.ownedByRequester) return
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
      setMessage('AI機能を停止しました。停止にAPI PINは不要です。')
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

      {!active && !heldByOther ? (
        <div className="summary-control-actions">
          <label className="field compact-field">
            <span>API PIN</span>
            <input
              autoComplete="off"
              disabled={busy || lectureStatus !== 'open'}
              inputMode="numeric"
              onChange={(event) => setBillingPin(event.target.value)}
              type="password"
              value={billingPin}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy || !billingPin.trim() || lectureStatus !== 'open'}
            onClick={() => void authorize('all_except_captions')}
            type="button"
          >
            字幕以外を許可
          </button>
          <button
            className="primary-button"
            disabled={busy || !billingPin.trim() || lectureStatus !== 'open'}
            onClick={() => void authorize('all_including_captions')}
            type="button"
          >
            字幕も含めて許可
          </button>
        </div>
      ) : null}

      {active ? (
        <div className="summary-control-actions">
          <span className="note">
            {authorization.scope === 'all_including_captions'
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

      {heldByOther ? (
        <p className="note">
          別の教員画面が許可を保持しています。二重実行を避けるため、この画面からは開始できません。
        </p>
      ) : null}
      {message ? (
        <p aria-live="polite" className="note">
          {message}
        </p>
      ) : null}
    </section>
  )
}
