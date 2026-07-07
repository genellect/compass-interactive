import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

function requireEnvValue(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} is not set. Check .env.local.`)
  }

  return value
}

export const supabase = createClient(
  requireEnvValue(supabaseUrl, 'VITE_SUPABASE_URL'),
  requireEnvValue(
    supabasePublishableKey,
    'VITE_SUPABASE_PUBLISHABLE_KEY',
  ),
)
