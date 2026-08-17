import {
  assertSupabaseConfigured,
  runWithAnonymousSignupAbortSignal,
  supabase,
} from './supabaseClient'
import { getAnonymousSignInCaptchaToken } from './turnstile'
import {
  RequestDeadlineError,
  waitForPromiseWithDeadline,
} from './asyncDeadline'

let anonymousSignInRequest: Promise<string> | null = null
const ANONYMOUS_SESSION_CHECK_TIMEOUT_MS = 6_000
const ANONYMOUS_SESSION_CREATE_TIMEOUT_MS = 12_000

async function createAnonymousSession(providedCaptchaToken?: string) {
  const challengeSignal = AbortSignal.timeout(
    ANONYMOUS_SESSION_CREATE_TIMEOUT_MS,
  )
  try {
    const captchaToken =
      providedCaptchaToken ??
      (await getAnonymousSignInCaptchaToken(challengeSignal))
    const { data, error } = await runWithAnonymousSignupAbortSignal(
      challengeSignal,
      () =>
        supabase.auth.signInAnonymously(
          captchaToken ? { options: { captchaToken } } : undefined,
        ),
    )

    if (error) {
      throw new Error(`匿名セッションの開始に失敗しました: ${error.message}`)
    }

    if (!data.user?.id || !data.session || data.user.is_anonymous !== true) {
      throw new Error('匿名セッションを開始できませんでした。')
    }

    return data.user.id
  } catch (error) {
    if (challengeSignal.aborted) {
      throw new RequestDeadlineError(
        '匿名セッションの開始',
        ANONYMOUS_SESSION_CREATE_TIMEOUT_MS,
      )
    }
    throw error
  }
}

function getOrCreateAnonymousSignInRequest(captchaToken?: string) {
  if (anonymousSignInRequest) return anonymousSignInRequest

  const request = createAnonymousSession(captchaToken)
  anonymousSignInRequest = request
  void request.then(
    () => {
      if (anonymousSignInRequest === request) anonymousSignInRequest = null
    },
    () => {
      if (anonymousSignInRequest === request) anonymousSignInRequest = null
    },
  )
  return request
}

export async function ensureAnonymousAuthSession(captchaToken?: string) {
  assertSupabaseConfigured()

  const { data, error } = await waitForPromiseWithDeadline(
    supabase.auth.getSession(),
    ANONYMOUS_SESSION_CHECK_TIMEOUT_MS,
    '匿名セッションの確認',
  )

  if (error) {
    throw new Error(`匿名セッションの確認に失敗しました: ${error.message}`)
  }

  if (data.session?.user.id && data.session.user.is_anonymous === true) {
    return data.session.user.id
  }

  if (data.session?.user.id) {
    throw new Error(
      '学生用セッションに匿名ではない認証情報が存在します。管理者認証とは別のブラウザ保存領域を使用してください。',
    )
  }

  return await getOrCreateAnonymousSignInRequest(captchaToken)
}
