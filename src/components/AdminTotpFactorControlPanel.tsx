import { useEffect, useState, type FormEvent } from 'react'
import {
  beginAdminControlStepUp,
  completeAdminControlStepUp,
} from '../lib/adminAuth/adminIdentityApi'
import {
  AdminAiUnlockError,
  prepareTotpFactorTransition,
  type TotpFactorAction,
} from '../lib/adminAuth/adminAiUnlockApi'
import {
  authorizeAndPersistTotpFactorTransition,
  finalizePersistedTotpFactorTransition,
  restoreAdminTotpTransitionRecovery,
  type AdminTotpTransitionRecoveryScope,
} from '../lib/adminAuth/adminTotpTransitionRecovery'
import { adminSupabase } from '../lib/adminAuth/adminSupabaseClient'

type FactorOption = {
  id: string
  label: string
}

type PendingTransition = {
  action: TotpFactorAction
  approvalFactorId: string
  controlIntentDigest: string
  controlStepUpNonce: string
  enrollmentSecret: null | {
    qrCode: string
    secret: string
  }
  mutationRequestId: string
  phase: 'authorization' | 'control' | 'upstream_add' | 'upstream_remove'
  recoveryExpiresAt: string
  targetFactorId: string
}

function factorLabel(factor: { id: string; friendly_name?: string }) {
  return factor.friendly_name?.trim() || `Authenticator …${factor.id.slice(-6)}`
}

function safeMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 240)
    : '認証アプリの変更を完了できませんでした。'
}

export function AdminTotpFactorControlPanel({
  appSessionToken,
  onReloginRequired,
  recoveryScope,
}: {
  appSessionToken: string
  onReloginRequired: () => Promise<void>
  recoveryScope: AdminTotpTransitionRecoveryScope
}) {
  const [verifiedFactors, setVerifiedFactors] = useState<FactorOption[]>([])
  const [approvalFactorId, setApprovalFactorId] = useState('')
  const [removeFactorId, setRemoveFactorId] = useState('')
  const [friendlyName, setFriendlyName] = useState('')
  const [controlCode, setControlCode] = useState('')
  const [candidateCode, setCandidateCode] = useState('')
  const [pending, setPending] = useState<PendingTransition | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function refreshFactors() {
    const { data, error } = await adminSupabase.auth.mfa.listFactors()
    if (error) throw error
    const factors = data.totp
      .filter((factor) => factor.status === 'verified')
      .map((factor) => ({
        id: factor.id,
        label: factorLabel(
          factor as typeof factor & { friendly_name?: string },
        ),
      }))
    setVerifiedFactors(factors)
    setApprovalFactorId((current) =>
      factors.some((factor) => factor.id === current)
        ? current
        : factors.length === 1
          ? factors[0].id
          : '',
    )
    setRemoveFactorId((current) =>
      factors.some((factor) => factor.id === current) ? current : '',
    )
    return factors
  }

  useEffect(() => {
    let active = true
    void refreshFactors().catch((error) => {
      if (active) setMessage(safeMessage(error))
    })
    return () => {
      active = false
    }
  }, [])

  function requireApprovalFactor(factors: FactorOption[]) {
    const selected =
      factors.find((factor) => factor.id === approvalFactorId) ??
      (factors.length === 1 ? factors[0] : undefined)
    if (!selected) {
      throw new Error('今回の重要操作を確認する認証アプリを選択してください。')
    }
    return selected.id
  }

  async function beginBoundControl(
    action: TotpFactorAction,
    targetFactorId: string,
    enrollmentSecret: PendingTransition['enrollmentSecret'],
  ) {
    const factors = await refreshFactors()
    const selectedApprovalFactorId = requireApprovalFactor(factors)
    const prepared = await prepareTotpFactorTransition(
      appSessionToken,
      action,
      targetFactorId,
    )
    if (
      typeof prepared.controlIntentDigest !== 'string' ||
      typeof prepared.recoveryExpiresAt !== 'string'
    ) {
      throw new Error('認証アプリ変更の内容を確認できませんでした。')
    }
    const mutationRequestId = crypto.randomUUID()
    const control = await beginAdminControlStepUp(
      appSessionToken,
      action,
      prepared.controlIntentDigest,
      mutationRequestId,
    )
    setPending({
      action,
      approvalFactorId: selectedApprovalFactorId,
      controlIntentDigest: prepared.controlIntentDigest,
      controlStepUpNonce: control.controlStepUpNonce,
      enrollmentSecret,
      mutationRequestId,
      phase: 'control',
      recoveryExpiresAt: prepared.recoveryExpiresAt,
      targetFactorId,
    })
    setControlCode('')
  }

  async function startAdd() {
    if (busy || pending) return
    setBusy(true)
    setMessage('')
    let enrolledFactorId = ''
    try {
      const factors = await refreshFactors()
      requireApprovalFactor(factors)
      const { data, error } = await adminSupabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName:
          friendlyName.trim().slice(0, 64) || 'COMPASS Admin Authenticator',
        issuer: 'COMPASS Interactive',
      })
      if (error) throw error
      enrolledFactorId = data.id
      await beginBoundControl('totp_factor_add', data.id, {
        qrCode: data.totp.qr_code.startsWith('data:image/svg+xml;utf-8,')
          ? data.totp.qr_code
          : '',
        secret: data.totp.secret,
      })
      setFriendlyName('')
      setMessage('既存の認証アプリで、今回だけ6桁コードを確認してください。')
    } catch (error) {
      if (enrolledFactorId) {
        await adminSupabase.auth.mfa
          .unenroll({ factorId: enrolledFactorId })
          .catch(() => undefined)
      }
      if (
        error instanceof AdminAiUnlockError &&
        error.code === 'relogin_required'
      ) {
        setMessage('認証セッションの残り時間が短いため、Googleログインをやり直します。')
        await onReloginRequired()
      } else {
        setMessage(safeMessage(error))
      }
    } finally {
      setBusy(false)
    }
  }

  async function startRemove() {
    if (busy || pending) return
    setBusy(true)
    setMessage('')
    try {
      const factors = await refreshFactors()
      requireApprovalFactor(factors)
      if (factors.length < 2) {
        throw new Error('最後の認証アプリは削除できません。先に別の認証アプリを追加してください。')
      }
      if (!factors.some((factor) => factor.id === removeFactorId)) {
        throw new Error('削除する認証アプリを選択してください。')
      }
      await beginBoundControl(
        'totp_factor_remove',
        removeFactorId,
        null,
      )
      setMessage('既存の認証アプリで、今回だけ6桁コードを確認してください。')
    } catch (error) {
      if (
        error instanceof AdminAiUnlockError &&
        error.code === 'relogin_required'
      ) {
        setMessage('認証セッションの残り時間が短いため、Googleログインをやり直します。')
        await onReloginRequired()
      } else {
        setMessage(safeMessage(error))
      }
    } finally {
      setBusy(false)
    }
  }

  async function finishFinalization() {
    const finalized = await finalizePersistedTotpFactorTransition(recoveryScope)
    if (!finalized) throw new Error('保存済みの変更を確認できませんでした。')
    setPending(null)
    setControlCode('')
    setCandidateCode('')
    setMessage('認証アプリの変更を確定しました。再ログインします。')
    await onReloginRequired()
  }

  async function applyRemove(current: PendingTransition) {
    try {
      await finishFinalization()
      return
    } catch (error) {
      if (
        !(error instanceof AdminAiUnlockError) ||
        error.code !== 'transition_incomplete'
      ) {
        throw error
      }
    }

    const { error: unenrollError } = await adminSupabase.auth.mfa.unenroll({
      factorId: current.targetFactorId,
    })
    if (unenrollError) {
      // The upstream success response may have been lost. The exact DB
      // finalizer is authoritative and idempotent, so try it before failing.
      try {
        await finishFinalization()
        return
      } catch {
        throw unenrollError
      }
    }
    await finishFinalization()
  }

  async function persistAuthorizedTransition(current: PendingTransition) {
    await authorizeAndPersistTotpFactorTransition(recoveryScope, appSessionToken, {
      action: current.action,
      intentDigest: current.controlIntentDigest,
      mutationRequestId: current.mutationRequestId,
      recoveryExpiresAt: current.recoveryExpiresAt,
      targetFactorId: current.targetFactorId,
    })
  }

  async function continueAuthorizedTransition(current: PendingTransition) {
    setControlCode('')
    if (current.action === 'totp_factor_remove') {
      const next = { ...current, phase: 'upstream_remove' as const }
      setPending(next)
      await applyRemove(next)
      return
    }
    setPending({ ...current, phase: 'upstream_add' })
    setMessage('追加する認証アプリを読み取り、その新しい6桁コードを入力してください。')
  }

  async function submitControl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pending || pending.phase !== 'control' || controlCode.length !== 6 || busy) {
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const recovery = await restoreAdminTotpTransitionRecovery(recoveryScope)
      if (recovery) {
        if (
          recovery.action !== pending.action ||
          recovery.intentDigest !== pending.controlIntentDigest ||
          recovery.mutationRequestId !== pending.mutationRequestId ||
          recovery.targetFactorId !== pending.targetFactorId
        ) {
          throw new Error('別の認証アプリ変更が回復待ちです。')
        }
        try {
          await persistAuthorizedTransition(pending)
          await continueAuthorizedTransition(pending)
          return
        } catch (error) {
          if (
            error instanceof AdminAiUnlockError &&
            error.code === 'relogin_required'
          ) {
            setPending(null)
            setMessage('認証セッションの残り時間が短いため、Googleログインをやり直します。')
            await onReloginRequired()
            return
          }
          if (
            !(error instanceof AdminAiUnlockError) ||
            error.code !== 'control_proof_required'
          ) {
            throw error
          }
        }
      }

      const { error } = await adminSupabase.auth.mfa.challengeAndVerify({
        code: controlCode,
        factorId: pending.approvalFactorId,
      })
      if (error) throw error
      const authorizing = { ...pending, phase: 'authorization' as const }
      setPending(authorizing)
      setControlCode('')
      await completeAdminControlStepUp(
        appSessionToken,
        authorizing.action,
        authorizing.mutationRequestId,
        authorizing.controlIntentDigest,
        authorizing.controlStepUpNonce,
      )
      await persistAuthorizedTransition(authorizing)
      await continueAuthorizedTransition(authorizing)
    } catch (error) {
      setControlCode('')
      setMessage(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function retryAuthorization() {
    if (!pending || pending.phase !== 'authorization' || busy) return
    setBusy(true)
    setMessage('')
    try {
      await persistAuthorizedTransition(pending)
      await continueAuthorizedTransition(pending)
    } catch (error) {
      if (
        error instanceof AdminAiUnlockError &&
        error.code === 'relogin_required'
      ) {
        setPending(null)
        setMessage('認証セッションの残り時間が短いため、Googleログインをやり直します。')
        await onReloginRequired()
      } else if (
        error instanceof AdminAiUnlockError &&
        error.code === 'control_proof_required'
      ) {
        setPending({ ...pending, phase: 'control' })
        setMessage('承認が完了していません。新しい6桁コードで今回だけ再確認してください。')
      } else {
        setMessage(safeMessage(error))
      }
    } finally {
      setBusy(false)
    }
  }

  async function retryFinalizationOnly() {
    if (!pending || busy) return
    setBusy(true)
    setMessage('')
    try {
      await finishFinalization()
    } catch (error) {
      setMessage(
        `${safeMessage(error)} 上流変更が未完了なら、同じ認証アプリ変更を続けてください。`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function retryRemove(current: PendingTransition) {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await applyRemove(current)
    } catch (error) {
      setMessage(
        `${safeMessage(error)} 上流削除が完了している場合は、同じ確定処理を再試行できます。`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function submitCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !pending ||
      pending.phase !== 'upstream_add' ||
      candidateCode.length !== 6 ||
      busy
    ) {
      return
    }
    setBusy(true)
    setMessage('')
    try {
      try {
        await finishFinalization()
        return
      } catch (error) {
        if (
          !(error instanceof AdminAiUnlockError) ||
          error.code !== 'transition_incomplete'
        ) {
          throw error
        }
      }
      const { error } = await adminSupabase.auth.mfa.challengeAndVerify({
        code: candidateCode,
        factorId: pending.targetFactorId,
      })
      if (error) throw error
      setCandidateCode('')
      await finishFinalization()
    } catch (error) {
      setCandidateCode('')
      setMessage(
        `${safeMessage(error)} 上流変更が完了している場合、ページを再読み込みして同じ確定処理を再試行できます。`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="admin-totp-factor-control-title"
      className="admin-ai-unlock-panel"
    >
      <p className="eyebrow">AUTHENTICATOR CONTROL</p>
      <h2 id="admin-totp-factor-control-title">認証アプリの管理</h2>
      <p>
        追加・削除のときだけ、現在承認済みの認証アプリで再確認します。講義中や通常のAI操作では要求しません。
      </p>

      {!pending ? (
        <>
          <label className="field">
            <span>今回の重要操作を確認する認証アプリ</span>
            <select
              disabled={busy}
              onChange={(event) => setApprovalFactorId(event.target.value)}
              value={approvalFactorId}
            >
              <option value="">選択してください</option>
              {verifiedFactors.map((factor) => (
                <option key={factor.id} value={factor.id}>
                  {factor.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>新しい認証アプリの表示名（任意）</span>
            <input
              disabled={busy}
              maxLength={64}
              onChange={(event) => setFriendlyName(event.target.value.slice(0, 64))}
              type="text"
              value={friendlyName}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy || !approvalFactorId}
            onClick={() => void startAdd()}
            type="button"
          >
            認証アプリを追加
          </button>

          {verifiedFactors.length > 1 ? (
            <>
              <label className="field">
                <span>削除する認証アプリ</span>
                <select
                  disabled={busy}
                  onChange={(event) => setRemoveFactorId(event.target.value)}
                  value={removeFactorId}
                >
                  <option value="">選択してください</option>
                  {verifiedFactors.map((factor) => (
                    <option key={factor.id} value={factor.id}>
                      {factor.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button"
                disabled={busy || !approvalFactorId || !removeFactorId}
                onClick={() => void startRemove()}
                type="button"
              >
                選択した認証アプリを削除
              </button>
            </>
          ) : (
            <p className="helper-note">最後の認証アプリは削除できません。</p>
          )}
        </>
      ) : null}

      {pending?.action === 'totp_factor_add' &&
      pending.enrollmentSecret &&
      (pending.phase === 'control' || pending.phase === 'authorization') ? (
        <div>
          <p>
            Scan this QR code before authorizing the factor change. The secret is
            never stored by COMPASS.
          </p>
          {pending.enrollmentSecret.qrCode ? (
            <img
              alt="QR code for the Authenticator being added"
              className="admin-totp-qr"
              src={pending.enrollmentSecret.qrCode}
            />
          ) : null}
          <details>
            <summary>Cannot scan the QR code</summary>
            <p className="admin-totp-secret">{pending.enrollmentSecret.secret}</p>
          </details>
        </div>
      ) : null}

      {pending?.phase === 'control' ? (
        <form onSubmit={submitControl}>
          <label className="field">
            <span>選択した既存認証アプリの6桁コード</span>
            <input
              autoComplete="one-time-code"
              disabled={busy}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                setControlCode(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
              pattern="[0-9]{6}"
              type="text"
              value={controlCode}
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || controlCode.length !== 6}
            type="submit"
          >
            重要操作を承認
          </button>
        </form>
      ) : null}

      {pending?.phase === 'authorization' ? (
        <div>
          <p className="helper-note">
            認証アプリ確認後の承認結果を回収します。6桁コードの再入力は不要です。
          </p>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void retryAuthorization()}
            type="button"
          >
            承認結果を再確認
          </button>
        </div>
      ) : null}

      {pending?.phase === 'upstream_add' && pending.enrollmentSecret ? (
        <form onSubmit={submitCandidate}>
          <p>追加する認証アプリで、次のQRコードを読み取ってください。</p>
          {pending.enrollmentSecret.qrCode ? (
            <img
              alt="追加する認証アプリ用QRコード"
              className="admin-totp-qr"
              src={pending.enrollmentSecret.qrCode}
            />
          ) : null}
          <details>
            <summary>QRコードを読み取れない場合</summary>
            <p className="admin-totp-secret">{pending.enrollmentSecret.secret}</p>
          </details>
          <label className="field">
            <span>追加する認証アプリの6桁コード</span>
            <input
              autoComplete="one-time-code"
              disabled={busy}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                setCandidateCode(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
              pattern="[0-9]{6}"
              type="text"
              value={candidateCode}
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || candidateCode.length !== 6}
            type="submit"
          >
            追加を確定
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void retryFinalizationOnly()}
            type="button"
          >
            上流変更済みとして確定を再試行
          </button>
        </form>
      ) : null}

      {pending?.phase === 'upstream_remove' ? (
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void retryRemove(pending)}
          type="button"
        >
          削除と確定を再試行
        </button>
      ) : null}

      {message ? (
        <p aria-live="polite" className="helper-note">
          {message}
        </p>
      ) : null}
    </section>
  )
}
