import { assertSupabaseConfigured, supabase } from './supabaseClient'
import { getAnonymousSignInCaptchaToken } from './turnstile'

let anonymousSignInRequest: Promise<string> | null = null

async function createAnonymousSession(providedCaptchaToken?: string) {
  const captchaToken =
    providedCaptchaToken ?? (await getAnonymousSignInCaptchaToken())
  const { data, error } = await supabase.auth.signInAnonymously(
    captchaToken ? { options: { captchaToken } } : undefined,
  )

  if (error) {
    throw new Error(`匿名セッションの開始に失敗しました: ${error.message}`)
  }

  if (!data.user?.id || !data.session || data.user.is_anonymous !== true) {
    throw new Error('匿名セッションを開始できませんでした。')
  }

  return data.user.id
}

export async function ensureAnonymousAuthSession(captchaToken?: string) {
  assertSupabaseConfigured()

  const { data, error } = await supabase.auth.getSession()

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

  if (!anonymousSignInRequest) {
    anonymousSignInRequest = createAnonymousSession(captchaToken)
  }

  try {
    return await anonymousSignInRequest
  } finally {
    anonymousSignInRequest = null
  }
}
