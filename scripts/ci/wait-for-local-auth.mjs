const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() ?? ''
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

if (!supabaseUrl || !publishableKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.',
  )
}

const parsedUrl = new URL(supabaseUrl)
if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)) {
  throw new Error('Auth readiness checks are restricted to local Supabase.')
}

const deadline = Date.now() + 120_000
const endpoint = `${supabaseUrl}/auth/v1/health`
let lastStatus = 'not started'
let ready = false

while (Date.now() < deadline) {
  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
      signal: AbortSignal.timeout(5_000),
    })
    lastStatus = String(response.status)
    if (response.status === 200) {
      console.log('Local Auth is ready.')
      ready = true
      break
    }
  } catch (error) {
    lastStatus = error instanceof Error ? error.message : String(error)
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000))
}

if (!ready) {
  throw new Error(`Local Auth did not become ready: ${lastStatus}`)
}
