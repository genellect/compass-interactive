import { assertSupabaseConfigured, supabase } from './supabaseClient'

let anonymousSignInRequest: Promise<string> | null = null

async function createAnonymousSession() {
  const { data, error } = await supabase.auth.signInAnonymously()

  if (error) {
    throw new Error(`匿名セッションの開始に失敗しました: ${error.message}`)
  }

  if (!data.user?.id || !data.session) {
    throw new Error('匿名セッションを開始できませんでした。')
  }

  return data.user.id
}

export async function ensureAnonymousAuthSession() {
  assertSupabaseConfigured()

  const { data, error } = await supabase.auth.getSession()

  if (error) {
    throw new Error(`匿名セッションの確認に失敗しました: ${error.message}`)
  }

  if (data.session?.user.id) {
    return data.session.user.id
  }

  if (!anonymousSignInRequest) {
    anonymousSignInRequest = createAnonymousSession()
  }

  try {
    return await anonymousSignInRequest
  } finally {
    anonymousSignInRequest = null
  }
}
