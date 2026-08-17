import { useEffect, useState, type FormEvent } from 'react'
import {
  beginAdminControlStepUp,
  completeAdminControlStepUp,
  type AdminControlAction,
} from '../lib/adminAuth/adminIdentityApi'
import {
  beginRememberedBrowserEnrollment,
  completeRememberedBrowserEnrollment,
  AdminAiUnlockError,
  getAdminAiUnlockProfile,
  getRememberedBrowserEnrollmentStatus,
  prepareAdminAiPinMutation,
  resetAdminAiPin,
  revokeAdminAiPin,
  revokeRememberedBrowserCredential,
  setAdminAiPin,
  type AdminAiUnlockProfile,
} from '../lib/adminAuth/adminAiUnlockApi'
import { adminSupabase } from '../lib/adminAuth/adminSupabaseClient'
import {
  activatePendingRememberedBrowserEnrollment,
  clearRememberedBrowserCredential,
  confirmPendingBrowserEnrollmentWindow,
  createPendingRememberedBrowserEnrollment,
  getPendingRememberedBrowserEnrollment,
  listRememberedBrowserCredentials,
  rotatePendingBrowserCompletionRequest,
  type RememberedBrowserIdentityScope,
  type PendingRememberedBrowserEnrollment,
  type RememberedBrowserCredential,
} from '../lib/adminAuth/rememberedBrowserCredential'

type PendingControl = {
  action: AdminControlAction
  controlIntentDigest: string
  controlStepUpNonce: string
  factorId: string
  kind: 'pin' | 'reset' | 'revoke'
  phase: 'authorization' | 'control'
  requestId: string
}

type VerifiedFactorOption = {
  id: string
  label: string
}

function safeMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 240)
    : 'Admin AI 設定を完了できませんでした。'
}

export function AdminAiUnlockPanel({
  appSessionToken,
  identityScope,
}: {
  appSessionToken: string
  identityScope: RememberedBrowserIdentityScope
}) {
  const [profile, setProfile] = useState<AdminAiUnlockProfile | null>(null)
  const [localCredentials, setLocalCredentials] = useState<
    RememberedBrowserCredential[]
  >([])
  const [pendingBrowserEnrollment, setPendingBrowserEnrollment] =
    useState<PendingRememberedBrowserEnrollment | null>(null)
  const [pin, setPin] = useState('')
  const [pinConfirmation, setPinConfirmation] = useState('')
  const [browserPin, setBrowserPin] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [pendingControl, setPendingControl] = useState<PendingControl | null>(
    null,
  )
  const [verifiedFactors, setVerifiedFactors] = useState<
    VerifiedFactorOption[]
  >([])
  const [selectedFactorId, setSelectedFactorId] = useState('')
  const [needsPinConfirmation, setNeedsPinConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function refresh() {
    const [nextProfile, credentials, pendingEnrollment] = await Promise.all([
      getAdminAiUnlockProfile(appSessionToken),
      listRememberedBrowserCredentials(identityScope),
      getPendingRememberedBrowserEnrollment(identityScope),
    ])
    setProfile(nextProfile)
    setLocalCredentials(credentials)
    setPendingBrowserEnrollment(pendingEnrollment)
  }

  useEffect(() => {
    let active = true
    const currentScope: RememberedBrowserIdentityScope = {
      environmentId: identityScope.environmentId,
      membershipId: identityScope.membershipId,
      principalId: identityScope.principalId,
    }
    void Promise.all([
      getAdminAiUnlockProfile(appSessionToken),
      listRememberedBrowserCredentials(currentScope),
      getPendingRememberedBrowserEnrollment(currentScope),
    ])
      .then(([nextProfile, credentials, pendingEnrollment]) => {
        if (!active) return
        setProfile(nextProfile)
        setLocalCredentials(credentials)
        setPendingBrowserEnrollment(pendingEnrollment)
      })
      .catch((error) => {
        if (active) setMessage(safeMessage(error))
      })
    void adminSupabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!active || error) return
      const factors = data.totp
        .filter((candidate) => candidate.status === 'verified')
        .map((candidate) => ({
          id: candidate.id,
          label:
            (
              candidate as typeof candidate & { friendly_name?: string }
            ).friendly_name?.trim() ||
            `Authenticator …${candidate.id.slice(-6)}`,
        }))
      setVerifiedFactors(factors)
      if (factors.length === 1) setSelectedFactorId(factors[0].id)
    })
    return () => {
      active = false
    }
  }, [
    appSessionToken,
    identityScope.environmentId,
    identityScope.membershipId,
    identityScope.principalId,
  ])

  async function getVerifiedFactorId() {
    const { data, error } = await adminSupabase.auth.mfa.listFactors()
    if (error) throw error
    const factors = data.totp
      .filter((candidate) => candidate.status === 'verified')
      .map((candidate) => ({
        id: candidate.id,
        label:
          (
            candidate as typeof candidate & { friendly_name?: string }
          ).friendly_name?.trim() || `Authenticator …${candidate.id.slice(-6)}`,
      }))
    setVerifiedFactors(factors)
    if (factors.length === 0) {
      throw new Error('認証アプリの登録を確認できませんでした。')
    }
    if (factors.length === 1) {
      setSelectedFactorId(factors[0].id)
      return factors[0].id
    }
    const selected = factors.find((factor) => factor.id === selectedFactorId)
    if (!selected) {
      throw new Error('今回確認する認証アプリを選択してください。')
    }
    return selected.id
  }

  async function startControl(
    kind: PendingControl['kind'],
    action: AdminControlAction,
    requestId: string,
    controlIntentDigest: string | null,
  ) {
    const factorId = await getVerifiedFactorId()
    const control = await beginAdminControlStepUp(
      appSessionToken,
      action,
      controlIntentDigest,
      requestId,
    )
    setPendingControl({
      action,
      controlIntentDigest: control.controlIntentDigest,
      controlStepUpNonce: control.controlStepUpNonce,
      factorId,
      kind,
      phase: 'control',
      requestId,
    })
    setTotpCode('')
  }

  async function submitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const completingPendingPin =
      needsPinConfirmation && pendingControl?.kind === 'pin'
    if (
      !/^\d{4}$/.test(pin) ||
      (!needsPinConfirmation && pin !== pinConfirmation) ||
      (pendingControl !== null && !completingPendingPin) ||
      busy
    )
      return
    setBusy(true)
    setMessage('')
    const submittedPin = pin
    setPin('')
    setPinConfirmation('')
    try {
      if (profile?.factorStatus === null) {
        const requestId = crypto.randomUUID()
        try {
          await setAdminAiPin(appSessionToken, submittedPin, requestId)
          setMessage(
            'AI PINを登録しました。ログイン時の認証を再利用したため、追加の認証アプリ確認はありません。',
          )
          await refresh()
          return
        } catch (error) {
          if (
            !(error instanceof AdminAiUnlockError) ||
            error.code !== 'control_proof_required'
          ) {
            throw error
          }
        }
        const prepared = await prepareAdminAiPinMutation(
          appSessionToken,
          submittedPin,
          'enroll',
          requestId,
        )
        await startControl(
          'pin',
          prepared.controlAction,
          requestId,
          prepared.controlIntentDigest,
        )
        setMessage(
          'ログイン確認の再利用期限を過ぎたため、認証アプリで今回だけ再確認してください。確認後、同じ新PINをもう一度入力します。',
        )
        return
      }
      if (needsPinConfirmation && pendingControl?.kind === 'pin') {
        try {
          await setAdminAiPin(
            appSessionToken,
            submittedPin,
            pendingControl.requestId,
          )
        } catch (error) {
          if (
            !(error instanceof AdminAiUnlockError) ||
            error.code !== 'control_proof_required'
          ) {
            throw error
          }
          const prepared = await prepareAdminAiPinMutation(
            appSessionToken,
            submittedPin,
            pendingControl.action === 'ai_pin_rotate' ? 'rotate' : 'enroll',
            pendingControl.requestId,
          )
          if (
            prepared.controlIntentDigest !== pendingControl.controlIntentDigest
          ) {
            throw new Error('AI PIN control intent changed unexpectedly.')
          }
          setNeedsPinConfirmation(false)
          await startControl(
            'pin',
            pendingControl.action,
            pendingControl.requestId,
            pendingControl.controlIntentDigest,
          )
          setMessage(
            'Fresh Authenticator approval is required to finish this PIN change.',
          )
          return
        }
        setNeedsPinConfirmation(false)
        setPendingControl(null)
        setMessage('AI PINを更新しました。')
        await refresh()
        return
      }

      const requestId = crypto.randomUUID()
      const prepared = await prepareAdminAiPinMutation(
        appSessionToken,
        submittedPin,
        profile?.activePin ? 'rotate' : 'enroll',
        requestId,
      )
      await startControl(
        'pin',
        prepared.controlAction,
        requestId,
        prepared.controlIntentDigest,
      )
      setMessage(
        '認証アプリで今回だけ再確認してください。確認後、同じ新PINをもう一度入力します。',
      )
    } catch (error) {
      setMessage(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function submitTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !pendingControl ||
      pendingControl.phase !== 'control' ||
      !/^\d{6}$/.test(totpCode) ||
      busy
    )
      return
    setBusy(true)
    setMessage('')
    try {
      const { error } = await adminSupabase.auth.mfa.challengeAndVerify({
        code: totpCode,
        factorId: pendingControl.factorId,
      })
      if (error) throw error
      const authorizing = {
        ...pendingControl,
        phase: 'authorization' as const,
      }
      setPendingControl(authorizing)
      setTotpCode('')
      await completeAdminControlStepUp(
        appSessionToken,
        authorizing.action,
        authorizing.requestId,
        authorizing.controlIntentDigest,
        authorizing.controlStepUpNonce,
      )
      if (authorizing.kind === 'pin') {
        setNeedsPinConfirmation(true)
        setMessage(
          '承認しました。同じ新PINをもう一度入力して更新を確定してください。',
        )
      } else {
        if (authorizing.kind === 'revoke') {
          await revokeAdminAiPin(appSessionToken, authorizing.requestId)
        } else {
          await resetAdminAiPin(appSessionToken, authorizing.requestId)
        }
        setPendingControl(null)
        setMessage(
          authorizing.kind === 'revoke'
            ? 'AI PINを無効化しました。'
            : 'AI PINをリセットしました。',
        )
        await refresh()
      }
    } catch (error) {
      setTotpCode('')
      setMessage(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function retryPendingControlAuthorization() {
    if (!pendingControl || pendingControl.phase !== 'authorization' || busy)
      return
    setBusy(true)
    setMessage('')
    try {
      if (pendingControl.kind === 'pin') {
        setNeedsPinConfirmation(true)
        setMessage(
          'Enter the same new 4-digit PIN once to recover the approval result.',
        )
        return
      }
      const operation =
        pendingControl.kind === 'revoke' ? revokeAdminAiPin : resetAdminAiPin
      try {
        await operation(appSessionToken, pendingControl.requestId)
      } catch (error) {
        if (
          !(error instanceof AdminAiUnlockError) ||
          error.code !== 'control_proof_required'
        ) {
          throw error
        }
        await startControl(
          pendingControl.kind,
          pendingControl.action,
          pendingControl.requestId,
          pendingControl.controlIntentDigest,
        )
        setMessage(
          'Fresh Authenticator approval is required to finish this operation.',
        )
        return
      }
      setPendingControl(null)
      setMessage('The AI PIN operation was recovered and completed.')
      await refresh()
    } catch (error) {
      setMessage(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function startTerminal(kind: 'revoke' | 'reset') {
    if (busy || pendingControl) return
    setBusy(true)
    setMessage('')
    try {
      const requestId = crypto.randomUUID()
      await startControl(
        kind,
        kind === 'revoke' ? 'ai_pin_revoke' : 'ai_pin_reset',
        requestId,
        null,
      )
      setMessage('認証アプリで今回だけ再確認してください。')
    } catch (error) {
      setMessage(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function setupRememberedBrowser() {
    if (!/^\d{4}$/.test(browserPin) || busy || pendingControl) return
    setBusy(true)
    setMessage('')
    const submittedPin = browserPin
    setBrowserPin('')
    let credential: PendingRememberedBrowserEnrollment | null = null
    try {
      credential =
        pendingBrowserEnrollment ??
        (await createPendingRememberedBrowserEnrollment(identityScope))
      setPendingBrowserEnrollment(credential)
      const remoteStatus = await getRememberedBrowserEnrollmentStatus(
        appSessionToken,
        {
          browserCredentialId: credential.id,
          credentialToken: credential.credentialToken,
          publicKeyFingerprint: credential.publicKeyFingerprint,
        },
      )
      if (
        remoteStatus.status === 'active' &&
        typeof remoteStatus.expiresAt === 'string'
      ) {
        const activated = await activatePendingRememberedBrowserEnrollment(
          credential,
          remoteStatus.expiresAt,
        )
        if (!activated) {
          throw new Error('Remembered-browser enrollment ownership changed.')
        }
        setPendingBrowserEnrollment(null)
        setMessage('Remembered-browser enrollment was recovered.')
        await refresh()
        return
      }
      if (Date.parse(credential.enrollmentExpiresAt) <= Date.now()) {
        credential =
          await createPendingRememberedBrowserEnrollment(identityScope)
        setPendingBrowserEnrollment(credential)
      }
      const begun = await beginRememberedBrowserEnrollment(appSessionToken, {
        absoluteExpiresAt: credential.expiresAt,
        browserCredentialId: credential.id,
        credentialToken: credential.credentialToken,
        enrollmentNonce: credential.enrollmentNonce,
        publicKeyFingerprint: credential.publicKeyFingerprint,
        publicKeyJwk: credential.publicKeyJwk,
        requestId: credential.beginRequestId,
      })
      if (typeof begun.expiresAt !== 'string') {
        throw new Error('Remembered-browser enrollment window is unavailable.')
      }
      const confirmed = await confirmPendingBrowserEnrollmentWindow(
        credential,
        begun.expiresAt,
      )
      if (!confirmed) {
        throw new Error('Remembered-browser enrollment ownership changed.')
      }
      credential = confirmed
      setPendingBrowserEnrollment(credential)
      const completed = await completeRememberedBrowserEnrollment(
        appSessionToken,
        {
          enrollmentNonce: credential.enrollmentNonce,
          pin: submittedPin,
          publicKeyJwk: credential.publicKeyJwk,
          requestId: credential.completionRequestId,
        },
      )
      const activated = await activatePendingRememberedBrowserEnrollment(
        credential,
        typeof completed.expiresAt === 'string'
          ? completed.expiresAt
          : credential.expiresAt,
      )
      if (!activated) {
        throw new Error('Remembered-browser enrollment ownership changed.')
      }
      setPendingBrowserEnrollment(null)
      setMessage('このブラウザを登録しました。PINは保存されていません。')
      await refresh()
    } catch (error) {
      if (
        credential &&
        error instanceof AdminAiUnlockError &&
        error.code === 'pin_denied'
      ) {
        const rotated = await rotatePendingBrowserCompletionRequest(credential)
        if (rotated) setPendingBrowserEnrollment(rotated)
      }
      setMessage(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function revokeCredential(credentialId: string) {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await revokeRememberedBrowserCredential(appSessionToken, credentialId)
      await clearRememberedBrowserCredential(credentialId, identityScope)
      setMessage('このブラウザの登録を解除しました。')
      await refresh()
    } catch (error) {
      setMessage(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (!profile) {
    return (
      <section aria-live="polite" className="admin-ai-unlock-panel">
        <p>{message || 'AI PIN設定を確認しています…'}</p>
      </section>
    )
  }

  if (!profile.canUseAi) {
    return (
      <section
        className="admin-ai-unlock-panel"
        aria-labelledby="admin-ai-unlock-title"
      >
        <p className="eyebrow">PERSONAL AI CONTROL</p>
        <h2 id="admin-ai-unlock-title">個人AI設定</h2>
        <p className="helper-note">
          AI機能はこのアカウントで停止されています。
        </p>
      </section>
    )
  }

  return (
    <section
      className="admin-ai-unlock-panel"
      aria-labelledby="admin-ai-unlock-title"
    >
      <p className="eyebrow">PERSONAL AI CONTROL</p>
      <h2 id="admin-ai-unlock-title">個人AI PIN</h2>
      <p>
        通常の講義中に認証アプリを繰り返し要求しません。認証アプリの再確認は、PIN変更・失効などの重要操作だけです。
      </p>
      {verifiedFactors.length > 1 ? (
        <label className="field">
          <span>重要操作で確認する認証アプリ</span>
          <select
            disabled={busy}
            onChange={(event) => setSelectedFactorId(event.target.value)}
            value={selectedFactorId}
          >
            <option value="">選択してください</option>
            {verifiedFactors.map((factor) => (
              <option key={factor.id} value={factor.id}>
                {factor.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <form onSubmit={submitPin}>
        <label className="field">
          <span>
            {needsPinConfirmation ? '同じ新PINを再入力' : '4桁の新AI PIN'}
          </span>
          <input
            autoComplete="new-password"
            disabled={
              busy || (pendingControl !== null && !needsPinConfirmation)
            }
            inputMode="numeric"
            maxLength={4}
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/g, '').slice(0, 4))
            }
            pattern="[0-9]{4}"
            type="password"
            value={pin}
          />
        </label>
        {!needsPinConfirmation ? (
          <label className="field">
            <span>確認</span>
            <input
              autoComplete="new-password"
              disabled={busy || pendingControl !== null}
              inputMode="numeric"
              maxLength={4}
              onChange={(event) =>
                setPinConfirmation(
                  event.target.value.replace(/\D/g, '').slice(0, 4),
                )
              }
              pattern="[0-9]{4}"
              type="password"
              value={pinConfirmation}
            />
          </label>
        ) : null}
        <button
          className="primary-button"
          disabled={
            busy ||
            (pendingControl !== null && !needsPinConfirmation) ||
            pin.length !== 4 ||
            (!needsPinConfirmation && pin !== pinConfirmation)
          }
          type="submit"
        >
          {profile.activePin ? 'PINを変更' : 'PINを登録'}
        </button>
      </form>

      {pendingControl?.phase === 'control' ? (
        <form onSubmit={submitTotp}>
          <label className="field">
            <span>認証アプリの6桁コード（今回のみ）</span>
            <input
              autoComplete="one-time-code"
              disabled={busy}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
              pattern="[0-9]{6}"
              type="text"
              value={totpCode}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy || totpCode.length !== 6}
            type="submit"
          >
            重要操作を承認
          </button>
        </form>
      ) : null}

      {pendingControl?.phase === 'authorization' && !needsPinConfirmation ? (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void retryPendingControlAuthorization()}
          type="button"
        >
          承認結果を再確認
        </button>
      ) : null}

      {profile.activePin && !pendingControl ? (
        <div className="admin-ai-unlock-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void startTerminal('revoke')}
            type="button"
          >
            PINを無効化
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void startTerminal('reset')}
            type="button"
          >
            PINをリセット
          </button>
        </div>
      ) : null}

      {profile.rememberedBrowserEnabled && profile.activePin ? (
        <div className="admin-ai-unlock-browser">
          <h3>このブラウザを記憶</h3>
          <p>
            秘密鍵はこのブラウザのIndexedDBに非抽出形式で保存されます。PINは保存しません。講義AI権限はまだ発行しません。
          </p>
          <label className="field">
            <span>現在の4桁AI PIN</span>
            <input
              autoComplete="current-password"
              disabled={busy || pendingControl !== null}
              inputMode="numeric"
              maxLength={4}
              onChange={(event) =>
                setBrowserPin(event.target.value.replace(/\D/g, '').slice(0, 4))
              }
              pattern="[0-9]{4}"
              type="password"
              value={browserPin}
            />
          </label>
          <button
            className="secondary-button"
            disabled={
              busy || pendingControl !== null || browserPin.length !== 4
            }
            onClick={() => void setupRememberedBrowser()}
            type="button"
          >
            現在のPINで登録
          </button>
          {localCredentials.map((credential) => (
            <div key={credential.id}>
              <span>
                登録済み:{' '}
                {new Date(credential.createdAt).toLocaleString('ja-JP')}
              </span>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void revokeCredential(credential.id)}
                type="button"
              >
                この登録を解除
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {message ? (
        <p aria-live="polite" className="helper-note">
          {message}
        </p>
      ) : null}
    </section>
  )
}
