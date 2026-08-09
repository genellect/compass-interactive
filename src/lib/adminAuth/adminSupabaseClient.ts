import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database'
import {
  ADMIN_AUTH_STORAGE_KEY,
  adminAuthStorage,
  createAdminAuthFetch,
} from './adminAuthStorage'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const adminSupabaseConfigError =
  !supabaseUrl || !supabasePublishableKey
    ? '管理者認証の接続先が設定されていません。'
    : null

const adminAuthFetch = createAdminAuthFetch(
  globalThis.fetch.bind(globalThis),
  supabaseUrl || 'https://example.supabase.co',
)

export const adminSupabase = createClient<Database>(
  supabaseUrl || 'https://example.supabase.co',
  supabasePublishableKey || 'missing-publishable-key',
  {
    global: {
      fetch: adminAuthFetch,
    },
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      persistSession: true,
      storage: adminAuthStorage,
      storageKey: ADMIN_AUTH_STORAGE_KEY,
    },
  },
)

export function getAdminOAuthCallbackUrl() {
  return `${window.location.origin}/admin/auth/callback`
}
