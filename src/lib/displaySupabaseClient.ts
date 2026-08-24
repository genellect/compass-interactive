import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { assertSupabaseConfigured } from './supabaseClient'
import { getAnonymousSignInCaptchaToken } from './turnstile'
import {
  RequestDeadlineError,
  waitForPromiseWithDeadline,
} from './asyncDeadline'

export const DISPLAY_AUTH_STORAGE_KEY =
  'compass-interactive-display-supabase-auth-v1'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const fallbackUrl = 'https://example.supabase.co'
const fallbackKey = 'missing-publishable-key'
const SESSION_CHECK_TIMEOUT_MS = 6_000
const SESSION_CREATE_TIMEOUT_MS = 12_000
let displaySignupAbortSignal: AbortSignal | null = null

const displaySupabaseFetch: typeof globalThis.fetch = (input, init) => {
  const requiredSignal = displaySignupAbortSignal
  if (!requiredSignal) return globalThis.fetch(input, init)
  const target = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
    supabaseUrl || fallbackUrl,
  )
  const method = (
    init?.method ??
    (typeof Request !== 'undefined' && input instanceof Request
      ? input.method
      : 'GET')
  ).toUpperCase()
  if (method !== 'POST' || target.pathname !== '/auth/v1/signup') {
    return globalThis.fetch(input, init)
  }
  if (!init?.signal || init.signal === requiredSignal) {
    return globalThis.fetch(input, { ...init, signal: requiredSignal })
  }
  const controller = new AbortController()
  const forward = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason)
  }
  const onExistingAbort = () => forward(init.signal as AbortSignal)
  const onRequiredAbort = () => forward(requiredSignal)
  init.signal.addEventListener('abort', onExistingAbort, { once: true })
  requiredSignal.addEventListener('abort', onRequiredAbort, { once: true })
  if (init.signal.aborted) forward(init.signal)
  if (requiredSignal.aborted) forward(requiredSignal)
  return globalThis
    .fetch(input, { ...init, signal: controller.signal })
    .finally(() => {
      init.signal?.removeEventListener('abort', onExistingAbort)
      requiredSignal.removeEventListener('abort', onRequiredAbort)
    })
}

async function runWithDisplaySignupAbortSignal<T>(
  signal: AbortSignal,
  request: () => Promise<T>,
) {
  if (displaySignupAbortSignal) {
    throw new Error('Display匿名セッションの開始処理が重複しています。')
  }
  displaySignupAbortSignal = signal
  try {
    return await request()
  } finally {
    if (displaySignupAbortSignal === signal) displaySignupAbortSignal = null
  }
}

export const displaySupabase = createClient<Database>(
  supabaseUrl || fallbackUrl,
  supabasePublishableKey || fallbackKey,
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      storageKey: DISPLAY_AUTH_STORAGE_KEY,
    },
    global: { fetch: displaySupabaseFetch },
  },
)

let anonymousSignInRequest: Promise<string> | null = null

async function createAnonymousSession() {
  const signal = AbortSignal.timeout(SESSION_CREATE_TIMEOUT_MS)
  try {
    const captchaToken = await getAnonymousSignInCaptchaToken(signal)
    const { data, error } = await runWithDisplaySignupAbortSignal(signal, () =>
      displaySupabase.auth.signInAnonymously(
        captchaToken ? { options: { captchaToken } } : undefined,
      ),
    )
    if (error) throw new Error(error.message)
    if (!data.session || data.user?.is_anonymous !== true) {
      throw new Error('Display匿名セッションを開始できませんでした。')
    }
    return data.user.id
  } catch (error) {
    if (signal.aborted) {
      throw new RequestDeadlineError(
        'Display匿名セッションの開始',
        SESSION_CREATE_TIMEOUT_MS,
      )
    }
    throw error
  }
}

export async function ensureDisplayAnonymousAuthSession() {
  assertSupabaseConfigured()
  const { data, error } = await waitForPromiseWithDeadline(
    displaySupabase.auth.getSession(),
    SESSION_CHECK_TIMEOUT_MS,
    'Display匿名セッションの確認',
  )
  if (error) throw new Error(error.message)
  if (data.session?.user.is_anonymous === true) return data.session.user.id
  if (data.session?.user.id) {
    await displaySupabase.auth.signOut({ scope: 'local' })
  }
  anonymousSignInRequest ??= createAnonymousSession().finally(() => {
    anonymousSignInRequest = null
  })
  return await anonymousSignInRequest
}
