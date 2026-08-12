const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() ?? ''
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
const allowedOrigin = process.env.TEST_ALLOWED_ORIGIN?.trim() ?? ''

if (!supabaseUrl || !publishableKey || !allowedOrigin) {
  throw new Error(
    'VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and TEST_ALLOWED_ORIGIN are required.',
  )
}

const parsedUrl = new URL(supabaseUrl)
if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)) {
  throw new Error('Edge readiness checks are restricted to local Supabase.')
}

const deadline = Date.now() + 120_000
const endpoint = `${supabaseUrl}/functions/v1/admin-identity-session`
let lastStatus = 'not started'
let ready = false

while (Date.now() < deadline) {
  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        Origin: allowedOrigin,
      },
      method: 'OPTIONS',
    })
    lastStatus = String(response.status)
    if (response.status === 200) {
      console.log('Local Edge Functions are ready.')
      ready = true
      break
    }
  } catch (error) {
    lastStatus = error instanceof Error ? error.message : String(error)
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000))
}

if (!ready) {
  throw new Error(`Local Edge Functions did not become ready: ${lastStatus}`)
}
