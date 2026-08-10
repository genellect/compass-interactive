import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AppIcon } from '../components/AppIcon'
import { AdminAiUnlockPanel } from '../components/AdminAiUnlockPanel'
import { AdminTotpFactorControlPanel } from '../components/AdminTotpFactorControlPanel'
import {
  isLegacyAdminPinLoginEnabled,
  isPhase730AdminAiUnlockEnabled,
  isPhase730AdminIdentityEnabled,
  isPhase730AdminTotpFactorMutationEnabled,
} from '../lib/featureFlags'
import {
  ADMIN_APP_SESSION_STORAGE_KEY,
  clearAdminAuthStorage,
  clearAdminOAuthAttempt,
  beginAdminOAuthAttempt,
  consumeAdminOAuthAttempt,
  persistAdminAppSessionToken,
  restoreAdminAppSessionToken,
} from '../lib/adminAuth/adminAuthStorage'
import { AdminAiUnlockError } from '../lib/adminAuth/adminAiUnlockApi'
import {
  authorizeAndPersistTotpFactorTransition,
  finalizePersistedTotpFactorTransition,
  getAdminTotpTransitionRecoveryScope,
  hasAdminTotpTransitionRecovery,
  purgeExpiredAdminTotpTransitionRecovery,
  restoreAdminTotpTransitionRecovery,
  type AdminTotpTransitionRecovery,
  type AdminTotpTransitionRecoveryScope,
} from '../lib/adminAuth/adminTotpTransitionRecovery'
import {
  adminSupabase,
  adminSupabaseConfigError,
  getAdminOAuthCallbackUrl,
} from '../lib/adminAuth/adminSupabaseClient'
import {
  admitGoogleAdmin,
  AdminIdentityError,
  beginGoogleAdminStepUp,
  completeGoogleAdminStepUp,
  restoreGoogleAdminSession,
  revokeGoogleAdminSession,
  type GoogleAdminSession,
} from '../lib/adminAuth/adminIdentityApi'
import './AdminPage.css'

const AdminLegacyApp = lazy(() => import('./AdminLegacyApp'))

type IdentityPhase =
  | 'booting'
  | 'callback'
  | 'challenge'
  | 'denied'
  | 'enrollment'
  | 'error'
  | 'ready'
  | 'signed_out'
  | 'transition_recovery'

type EnrollmentSecret = {
  qrCode: string
  secret: string
}

function getSafeMessage(error: unknown) {
  if (error instanceof AdminIdentityError) return error.message
  return '管理者認証を確認できませんでした。時間をおいて再度お試しください。'
}

function AdminRouteHeader() {
  return (
    <header className="app-header">
      <a className="brand" href="/join" aria-label="COMPASS Interactive">
        <span className="brand-mark" aria-hidden="true" />
        <span>
          <strong>COMPASS Interactive</strong>
          <small>Lecture Experience</small>
        </span>
      </a>
      <nav aria-label="画面切り替え">
        <a className="nav-link" href="/join">
          <AppIcon name="users" size={17} />
          学生画面
        </a>
      </nav>
    </header>
  )
}

function RouteFallback() {
  return (
    <main className="route-fallback" aria-live="polite">
      <span className="route-loader" aria-hidden="true" />
      <p>管理画面を準備しています…</p>
    </main>
  )
}

export function AdminRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const callbackStarted = useRef(false)
  const bootStarted = useRef(false)
  const enrollmentSecretRef = useRef<EnrollmentSecret | null>(null)
  const [useLegacy, setUseLegacy] = useState(!isPhase730AdminIdentityEnabled)
  const [phase, setPhase] = useState<IdentityPhase>('booting')
  const [errorMessage, setErrorMessage] = useState('')
  const [factorId, setFactorId] = useState('')
  const [enrollmentSecret, setEnrollmentSecret] =
    useState<EnrollmentSecret | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [session, setSession] = useState<GoogleAdminSession | null>(null)
  const [transitionRecovery, setTransitionRecovery] =
    useState<AdminTotpTransitionRecovery | null>(null)
  const [transitionRecoveryScope, setTransitionRecoveryScope] =
    useState<AdminTotpTransitionRecoveryScope | null>(null)
  const [transitionCandidateCode, setTransitionCandidateCode] = useState('')

  const clearEnrollmentSecret = useCallback(() => {
    enrollmentSecretRef.current = null
    setEnrollmentSecret(null)
    setTotpCode('')
  }, [])

  const prepareIdentity = useCallback(async (skipTransitionRecovery = false) => {
    if (adminSupabaseConfigError) {
      setErrorMessage(adminSupabaseConfigError)
      setPhase('error')
      return
    }
    const { data, error } = await adminSupabase.auth.getSession()
    if (error) throw error
    if (!data.session) {
      setSession(null)
      setTransitionRecoveryScope(null)
      setPhase('signed_out')
      return
    }
    const currentRecoveryScope = getAdminTotpTransitionRecoveryScope(
      data.session.user.id,
      data.session.access_token,
    )
    if (!currentRecoveryScope) {
      throw new Error('The Google session recovery scope is invalid.')
    }
    setTransitionRecoveryScope(currentRecoveryScope)

    if (!skipTransitionRecovery) {
      const recovery = await restoreAdminTotpTransitionRecovery(
        currentRecoveryScope,
      )
      if (recovery) {
        try {
          const finalized = await finalizePersistedTotpFactorTransition(
            currentRecoveryScope,
            recovery,
          )
          if (finalized) {
            try {
              await adminSupabase.auth.signOut({ scope: 'local' })
            } finally {
              clearAdminAuthStorage()
              setSession(null)
              setTransitionRecoveryScope(null)
              setTransitionRecovery(null)
              setErrorMessage(
                '認証アプリの変更を確定しました。新しい認証構成でGoogleログインをやり直してください。',
              )
              setPhase('signed_out')
            }
            return
          }
        } catch (error) {
          setSession(null)
          setTransitionRecovery(recovery)
          setErrorMessage(
            error instanceof AdminAiUnlockError &&
              error.code === 'transition_incomplete'
              ? '認証アプリ側の変更をまだ確認できません。変更済みなら同じ処理を再試行してください。変更前の取消は競合を安全に判定できないため、この画面では行いません。'
              : '認証アプリ変更の回復処理を完了できませんでした。保存済みの同じ処理を再試行してください。',
          )
          setPhase('transition_recovery')
          return
        }
      }
    }

    const appSessionToken = restoreAdminAppSessionToken()
    if (appSessionToken) {
      try {
        const restored = await restoreGoogleAdminSession(appSessionToken)
        setSession(restored)
        setPhase('ready')
        return
      } catch (error) {
        if (
          error instanceof AdminIdentityError &&
          error.code === 'app_session_invalid'
        ) {
          window.sessionStorage.removeItem(ADMIN_APP_SESSION_STORAGE_KEY)
        } else {
          throw error
        }
      }
    }

    await admitGoogleAdmin()
    const { data: factors, error: factorsError } =
      await adminSupabase.auth.mfa.listFactors()
    if (factorsError) throw factorsError
    const verifiedFactor = factors.totp.find(
      (factor) => factor.status === 'verified',
    )
    if (verifiedFactor) {
      setFactorId(verifiedFactor.id)
      setPhase('challenge')
      return
    }

    const { data: enrolled, error: enrollError } =
      await adminSupabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'COMPASS Interactive Admin',
        issuer: 'COMPASS Interactive',
      })
    if (enrollError) throw enrollError
    const secret = {
      qrCode: enrolled.totp.qr_code.startsWith('data:image/svg+xml;utf-8,')
        ? enrolled.totp.qr_code
        : '',
      secret: enrolled.totp.secret,
    }
    enrollmentSecretRef.current = secret
    setEnrollmentSecret(secret)
    setFactorId(enrolled.id)
    setPhase('enrollment')
  }, [])

  useEffect(() => {
    if (
      !isPhase730AdminIdentityEnabled &&
      location.pathname === '/admin/auth/callback'
    ) {
      clearAdminOAuthAttempt()
      window.history.replaceState({}, '', '/admin')
      navigate('/admin', { replace: true })
      return
    }
    if (useLegacy || !isPhase730AdminIdentityEnabled) return
    if (location.pathname === '/admin/auth/callback') {
      if (callbackStarted.current) return
      callbackStarted.current = true
      setPhase('callback')

      const parameters = new URLSearchParams(location.search)
      const codes = parameters.getAll('code')
      window.history.replaceState({}, '', '/admin')
      const allowedKeys = new Set(['code'])
      const hasUnexpectedParameter = Array.from(parameters.keys()).some(
        (key) => !allowedKeys.has(key),
      )
      if (
        codes.length !== 1 ||
        !codes[0] ||
        hasUnexpectedParameter ||
        !consumeAdminOAuthAttempt()
      ) {
        setErrorMessage(
          'Googleログインの応答を確認できませんでした。最初からやり直してください。',
        )
        setPhase('error')
        return
      }

      void adminSupabase.auth
        .exchangeCodeForSession(codes[0])
        .then(({ error }) => {
          if (error) throw error
          bootStarted.current = true
          window.history.replaceState({}, '', '/admin')
          navigate('/admin', { replace: true })
          return prepareIdentity()
        })
        .catch((error) => {
          setErrorMessage(getSafeMessage(error))
          setPhase('error')
        })
      return
    }

    if (location.pathname !== '/admin') {
      setErrorMessage('管理者認証のURLが正しくありません。')
      setPhase('error')
      return
    }
    if (bootStarted.current) return
    bootStarted.current = true
    void prepareIdentity().catch((error) => {
      setErrorMessage(getSafeMessage(error))
      setPhase(error instanceof AdminIdentityError ? 'denied' : 'error')
    })
  }, [location.pathname, location.search, navigate, prepareIdentity, useLegacy])

  useEffect(
    () => () => {
      enrollmentSecretRef.current = null
    },
    [],
  )

  async function startGoogleLogin() {
    if (adminSupabaseConfigError) {
      setErrorMessage(adminSupabaseConfigError)
      setPhase('error')
      return
    }
    setErrorMessage('')
    beginAdminOAuthAttempt()
    const { error } = await adminSupabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAdminOAuthCallbackUrl(),
        scopes: 'openid email profile',
      },
    })
    if (error) {
      clearAdminOAuthAttempt()
      setErrorMessage('Googleログインを開始できませんでした。')
      setPhase('error')
    }
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^\d{6}$/.test(totpCode) || !factorId || isSubmitting) return
    setIsSubmitting(true)
    setErrorMessage('')
    try {
      const { stepUpNonce } = await beginGoogleAdminStepUp(factorId)
      const { error } = await adminSupabase.auth.mfa.challengeAndVerify({
        code: totpCode,
        factorId,
      })
      if (error) throw error
      const completed = await completeGoogleAdminStepUp(stepUpNonce)
      persistAdminAppSessionToken(completed.appSessionToken)
      setSession(completed.session)
      clearEnrollmentSecret()
      setPhase('ready')
    } catch (error) {
      setTotpCode('')
      setErrorMessage(
        error instanceof AdminIdentityError
          ? error.message
          : '6桁コードを確認できませんでした。新しいコードで再度お試しください。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function logout() {
    if (
      transitionRecoveryScope &&
      (await hasAdminTotpTransitionRecovery(transitionRecoveryScope))
    ) {
      const recovery = await restoreAdminTotpTransitionRecovery(
        transitionRecoveryScope,
      )
      setTransitionRecovery(recovery)
      setErrorMessage(
        '認証アプリ変更の回復中はログアウトできません。期限内に同じ変更を確定してください。',
      )
      setPhase('transition_recovery')
      return
    }
    setIsSubmitting(true)
    const appSessionToken = restoreAdminAppSessionToken()
    let logoutError = false
    try {
      if (appSessionToken) await revokeGoogleAdminSession(appSessionToken)
    } catch {
      logoutError = true
    }
    try {
      const { error } = await adminSupabase.auth.signOut({ scope: 'local' })
      if (error) logoutError = true
    } catch {
      logoutError = true
    } finally {
      clearEnrollmentSecret()
      clearAdminAuthStorage()
      setSession(null)
      setTransitionRecoveryScope(null)
      setErrorMessage(
        logoutError
          ? 'ログアウトの通信を完了できませんでした。安全のため、このブラウザの管理セッションは削除しました。ネットワーク接続後にもう一度Googleログインし、他の端末のセッションも確認してください。'
          : '',
      )
      setPhase('signed_out')
      setIsSubmitting(false)
    }
  }

  async function retryTotpTransitionRecovery() {
    if (isSubmitting || !transitionRecovery || !transitionRecoveryScope) return
    setIsSubmitting(true)
    setPhase('booting')
    try {
      if (Date.now() >= Date.parse(transitionRecovery.expiresAt) + 5_000) {
        await purgeExpiredAdminTotpTransitionRecovery(transitionRecoveryScope)
        setTransitionRecovery(null)
        await prepareIdentity(true)
        return
      }

      try {
        await finalizePersistedTotpFactorTransition(
          transitionRecoveryScope,
          transitionRecovery,
        )
      } catch (error) {
        if (
          !(error instanceof AdminAiUnlockError) ||
          error.code !== 'transition_incomplete'
        ) {
          throw error
        }

        // The local recovery token is written before the authorize request so
        // a lost success response can be recovered. Its presence alone is not
        // authorization: a request may have failed before the DB committed.
        // Reconfirm the exact durable transition before changing GoTrue MFA.
        const recoveryAppSessionToken = restoreAdminAppSessionToken()
        if (!recoveryAppSessionToken) {
          throw new Error(
            '認証アプリ変更の承認状態を確認できません。回復期限まで上流の認証アプリを変更せず、同じ管理タブから再試行してください。',
          )
        }
        await authorizeAndPersistTotpFactorTransition(
          transitionRecoveryScope,
          recoveryAppSessionToken,
          {
            action: transitionRecovery.action,
            intentDigest: transitionRecovery.intentDigest,
            mutationRequestId: transitionRecovery.mutationRequestId,
            recoveryExpiresAt: transitionRecovery.expiresAt,
            targetFactorId: transitionRecovery.targetFactorId,
          },
        )

        if (transitionRecovery.action === 'totp_factor_remove') {
          const { error: unenrollError } = await adminSupabase.auth.mfa.unenroll({
            factorId: transitionRecovery.targetFactorId,
          })
          if (unenrollError) {
            try {
              await finalizePersistedTotpFactorTransition(
                transitionRecoveryScope,
                transitionRecovery,
              )
            } catch {
              throw unenrollError
            }
          } else {
            await finalizePersistedTotpFactorTransition(
              transitionRecoveryScope,
              transitionRecovery,
            )
          }
        } else {
          if (!/^\d{6}$/.test(transitionCandidateCode)) {
            throw new Error('追加先の認証アプリに表示された6桁コードを入力してください。')
          }
          const submittedCode = transitionCandidateCode
          setTransitionCandidateCode('')
          const { error: verificationError } =
            await adminSupabase.auth.mfa.challengeAndVerify({
              code: submittedCode,
              factorId: transitionRecovery.targetFactorId,
            })
          if (verificationError) {
            // Verification may have committed upstream before its response was
            // lost. The exact finalizer is authoritative, so try it once before
            // asking the teacher for a new code.
            try {
              await finalizePersistedTotpFactorTransition(
                transitionRecoveryScope,
                transitionRecovery,
              )
            } catch {
              throw verificationError
            }
          } else {
            await finalizePersistedTotpFactorTransition(
              transitionRecoveryScope,
              transitionRecovery,
            )
          }
        }
      }
      try {
        await adminSupabase.auth.signOut({ scope: 'local' })
      } finally {
        clearAdminAuthStorage()
        setSession(null)
        setTransitionRecoveryScope(null)
        setTransitionRecovery(null)
        setErrorMessage(
          '認証アプリの変更を確定しました。新しい認証構成でGoogleログインをやり直してください。',
        )
        setPhase('signed_out')
      }
    } catch (error) {
      setErrorMessage(
        error instanceof AdminAiUnlockError &&
          error.code === 'transition_incomplete'
          ? '上流の認証アプリ変更がまだ完了していません。期限内に同じ変更を完了して再試行してください。'
          : transitionRecovery.action === 'totp_factor_add'
            ? '追加先の認証アプリを事前に読み取り、表示された最新の6桁コードで再試行してください。コードやQRの秘密はCOMPASSに保存されません。'
          : getSafeMessage(error),
      )
      setPhase('transition_recovery')
    } finally {
      setIsSubmitting(false)
    }
  }

  const transitionRecoveryExpired = Boolean(
    transitionRecovery && Date.now() >= Date.parse(transitionRecovery.expiresAt) + 5_000,
  )

  let content
  if (useLegacy) {
    content = (
      <Suspense fallback={<RouteFallback />}>
        <AdminLegacyApp />
      </Suspense>
    )
  } else if (phase === 'booting' || phase === 'callback') {
    content = <RouteFallback />
  } else if (phase === 'signed_out') {
    content = (
      <main className="page-shell join-page">
        <section className="join-card admin-identity-card">
          <span className="admin-login-icon">
            <AppIcon name="compass" size={25} />
          </span>
          <p className="eyebrow">FOR EDUCATORS</p>
          <h1>教員としてログイン</h1>
          <p>登録済みのGoogleアカウントと認証アプリで本人確認します。</p>
          {errorMessage ? (
            <p className="error-note" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <button
            className="primary-button"
            onClick={() => void startGoogleLogin()}
            type="button"
          >
            Googleで続ける
          </button>
          {isLegacyAdminPinLoginEnabled ? (
            <button
              className="secondary-button"
              onClick={() => setUseLegacy(true)}
              type="button"
            >
              従来の管理PINを使う
            </button>
          ) : null}
        </section>
      </main>
    )
  } else if (phase === 'transition_recovery' && transitionRecovery) {
    content = (
      <main className="page-shell join-page">
        <section className="join-card admin-identity-card">
          <p className="eyebrow">AUTHENTICATOR RECOVERY</p>
          <h1>認証アプリの変更を確定</h1>
          <p className="error-note" role="alert">
            {errorMessage}
          </p>
          <p>
            回復期限: {new Date(transitionRecovery.expiresAt).toLocaleString('ja-JP')}
          </p>
          {!transitionRecoveryExpired &&
          transitionRecovery.action === 'totp_factor_add' ? (
            <label className="field">
              <span>追加先の認証アプリに表示された6桁コード</span>
              <input
                autoComplete="one-time-code"
                disabled={isSubmitting}
                inputMode="numeric"
                maxLength={6}
                onChange={(event) =>
                  setTransitionCandidateCode(
                    event.target.value.replace(/\D/g, '').slice(0, 6),
                  )
                }
                pattern="[0-9]{6}"
                type="text"
                value={transitionCandidateCode}
              />
            </label>
          ) : null}
          <button
            className="primary-button"
            disabled={
              isSubmitting ||
              (!transitionRecoveryExpired &&
                transitionRecovery.action === 'totp_factor_add' &&
                transitionCandidateCode.length !== 6)
            }
            onClick={() => void retryTotpTransitionRecovery()}
            type="button"
          >
            {transitionRecoveryExpired
              ? '期限切れ後の本人確認へ進む'
              : transitionRecovery.action === 'totp_factor_remove'
                ? '同じ削除と確定を再試行'
                : '追加済み変更の確定を再試行'}
          </button>
          <p className="helper-note">
            {transitionRecoveryExpired
              ? '回復期限が切れました。承認済み構成と現在構成が異なる場合は、復旧承認が必要な状態として安全に停止します。'
              : '安全な取消は上流変更との競合を原子的に判定できないため、この画面では行いません。期限内に同じ変更を完了して再試行してください。'}
          </p>
        </section>
      </main>
    )
  } else if (phase === 'enrollment' || phase === 'challenge') {
    content = (
      <main className="page-shell join-page">
        <form className="join-card admin-identity-card" onSubmit={verifyTotp}>
          <p className="eyebrow">TWO-STEP VERIFICATION</p>
          <h1>
            {phase === 'enrollment'
              ? '初回のみ認証アプリを設定'
              : '認証アプリで確認'}
          </h1>
          {phase === 'enrollment' && enrollmentSecret ? (
            <>
              <p>スマートフォンの認証アプリでQRコードを読み取ってください。</p>
              {enrollmentSecret.qrCode ? (
                <img
                  alt="認証アプリ登録用QRコード"
                  className="admin-totp-qr"
                  src={enrollmentSecret.qrCode}
                />
              ) : null}
              <details>
                <summary>QRコードを読み取れない場合</summary>
                <p className="admin-totp-secret">{enrollmentSecret.secret}</p>
              </details>
            </>
          ) : (
            <p>認証アプリに表示されている最新の6桁コードを入力してください。</p>
          )}
          <label className="field">
            <span>6桁コード</span>
            <input
              aria-label="認証アプリの6桁コード"
              autoComplete="one-time-code"
              disabled={isSubmitting}
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
          {errorMessage ? (
            <p className="error-note" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <button
            className="primary-button"
            disabled={isSubmitting || totpCode.length !== 6}
            type="submit"
          >
            {isSubmitting ? '確認中…' : '確認して続ける'}
          </button>
        </form>
      </main>
    )
  } else if (phase === 'ready' && session) {
    content = (
      <main className="page-shell join-page">
        <section className="join-card admin-identity-card">
          <p className="eyebrow">IDENTITY READY</p>
          <h1>Google＋2段階認証を確認しました</h1>
          <p>
            個別の管理者セッションを作成しました。講義操作のGoogle権限移行は次のPhase
            7.30Cで行うため、B1では既存権限へ自動昇格しません。
          </p>
          <dl className="admin-identity-summary">
            <div>
              <dt>役割</dt>
              <dd>{session.role === 'owner' ? 'Owner' : 'Instructor'}</dd>
            </div>
            <div>
              <dt>セッション期限</dt>
              <dd>{new Date(session.expiresAt).toLocaleString('ja-JP')}</dd>
            </div>
          </dl>
          {isPhase730AdminTotpFactorMutationEnabled &&
          transitionRecoveryScope ? (
            <AdminTotpFactorControlPanel
              appSessionToken={restoreAdminAppSessionToken()}
              onReloginRequired={logout}
              recoveryScope={transitionRecoveryScope}
            />
          ) : null}
          {isPhase730AdminAiUnlockEnabled ? (
            <AdminAiUnlockPanel
              appSessionToken={restoreAdminAppSessionToken()}
              identityScope={{
                environmentId: session.environmentId,
                membershipId: session.membershipId,
                principalId: session.principalId,
              }}
            />
          ) : null}
          {isLegacyAdminPinLoginEnabled ? (
            <button
              className="primary-button"
              onClick={() => setUseLegacy(true)}
              type="button"
            >
              従来PINで講義操作へ
            </button>
          ) : null}
          <button
            className="secondary-button"
            disabled={isSubmitting}
            onClick={() => void logout()}
            type="button"
          >
            Google管理者セッションを終了
          </button>
        </section>
      </main>
    )
  } else {
    content = (
      <main className="page-shell join-page">
        <section className="join-card admin-identity-card">
          <p className="eyebrow">ADMIN IDENTITY</p>
          <h1>
            {phase === 'denied'
              ? 'このアカウントは利用できません'
              : '管理者認証を完了できませんでした'}
          </h1>
          <p className="error-note" role="alert">
            {errorMessage || '最初からやり直してください。'}
          </p>
          <button
            className="secondary-button"
            onClick={() => void logout()}
            type="button"
          >
            ログアウトしてやり直す
          </button>
          {isLegacyAdminPinLoginEnabled ? (
            <button
              className="secondary-button"
              onClick={() => setUseLegacy(true)}
              type="button"
            >
              従来の管理PINを使う
            </button>
          ) : null}
        </section>
      </main>
    )
  }

  return (
    <div className="app-root theme-light">
      <AdminRouteHeader />
      {content}
    </div>
  )
}
