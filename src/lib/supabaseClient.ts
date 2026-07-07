import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

const fallbackSupabaseUrl = 'https://example.supabase.co'
const fallbackSupabasePublishableKey = 'missing-publishable-key'

export const supabaseConfigError =
  !supabaseUrl || !supabasePublishableKey
    ? 'Cloudflare PagesにVITE_SUPABASE_URLとVITE_SUPABASE_PUBLISHABLE_KEYを設定し、再デプロイしてください。'
    : null

export function assertSupabaseConfigured() {
  if (supabaseConfigError) {
    throw new Error(supabaseConfigError)
  }
}

export const supabase = createClient(
  supabaseUrl || fallbackSupabaseUrl,
  supabasePublishableKey || fallbackSupabasePublishableKey,
)
