import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

const fallbackSupabaseUrl = 'https://example.supabase.co'
const fallbackSupabasePublishableKey = 'missing-publishable-key'
const resolvedSupabaseUrl = supabaseUrl || fallbackSupabaseUrl
let anonymousSignupAbortSignal: AbortSignal | null = null

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase()
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.method.toUpperCase()
  }
  return 'GET'
}

function isAnonymousSignupRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  if (requestMethod(input, init) !== 'POST') return false

  try {
    const target = new URL(requestUrl(input), resolvedSupabaseUrl)
    const configured = new URL(resolvedSupabaseUrl)
    return (
      target.origin === configured.origin &&
      target.pathname === '/auth/v1/signup'
    )
  } catch {
    return false
  }
}

function mergeAbortSignals(
  existingSignal: AbortSignal | null | undefined,
  requiredSignal: AbortSignal,
) {
  if (!existingSignal || existingSignal === requiredSignal) {
    return { cleanup: () => undefined, signal: requiredSignal }
  }

  const controller = new AbortController()
  const forwardAbort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason)
  }
  const handleExistingAbort = () => forwardAbort(existingSignal)
  const handleRequiredAbort = () => forwardAbort(requiredSignal)

  if (existingSignal.aborted) {
    forwardAbort(existingSignal)
  } else if (requiredSignal.aborted) {
    forwardAbort(requiredSignal)
  } else {
    existingSignal.addEventListener('abort', handleExistingAbort, {
      once: true,
    })
    requiredSignal.addEventListener('abort', handleRequiredAbort, {
      once: true,
    })
  }

  return {
    cleanup: () => {
      existingSignal.removeEventListener('abort', handleExistingAbort)
      requiredSignal.removeEventListener('abort', handleRequiredAbort)
    },
    signal: controller.signal,
  }
}

const studentSupabaseFetch: typeof globalThis.fetch = (input, init) => {
  const signupSignal = anonymousSignupAbortSignal
  if (!signupSignal || !isAnonymousSignupRequest(input, init)) {
    return globalThis.fetch(input, init)
  }

  const { cleanup, signal } = mergeAbortSignals(init?.signal, signupSignal)
  return globalThis.fetch(input, { ...init, signal }).finally(cleanup)
}

export const supabaseConfigError =
  !supabaseUrl || !supabasePublishableKey
    ? 'Cloudflare PagesにVITE_SUPABASE_URLとVITE_SUPABASE_PUBLISHABLE_KEYを設定し、再デプロイしてください。'
    : null

export function assertSupabaseConfigured() {
  if (supabaseConfigError) {
    throw new Error(supabaseConfigError)
  }
}

export async function runWithAnonymousSignupAbortSignal<T>(
  signal: AbortSignal,
  request: () => Promise<T>,
) {
  if (anonymousSignupAbortSignal) {
    throw new Error('匿名セッションの開始処理が重複しています。')
  }

  anonymousSignupAbortSignal = signal
  try {
    return await request()
  } finally {
    if (anonymousSignupAbortSignal === signal) {
      anonymousSignupAbortSignal = null
    }
  }
}

export const supabase = createClient<Database>(
  resolvedSupabaseUrl,
  supabasePublishableKey || fallbackSupabasePublishableKey,
  {
    auth: {
      // The student client owns only anonymous sessions. OAuth callback codes
      // are exchanged exclusively by the lazy Admin client.
      detectSessionInUrl: false,
    },
    global: {
      fetch: studentSupabaseFetch,
    },
  },
)
