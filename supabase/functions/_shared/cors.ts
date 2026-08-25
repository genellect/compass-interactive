const localDevelopmentOrigins = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]

function configuredOrigins() {
  const configured = Deno.env.get('COMPASS_EDGE_ALLOWED_ORIGINS')?.trim()
  return new Set(
    (configured ? configured.split(',') : localDevelopmentOrigins)
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
}

export function getAllowedCorsOrigin(request: Request) {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  return configuredOrigins().has(origin) ? origin : null
}

export function getCorsHeaders(request: Request) {
  const headers = new Headers({
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  })
  const origin = getAllowedCorsOrigin(request)
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
  }
  return headers
}

export function handleCors(request: Request) {
  const requestedOrigin = request.headers.get('Origin')
  if (requestedOrigin && !getAllowedCorsOrigin(request)) {
    return new Response(
      JSON.stringify({ message: 'Origin is not allowed.', ok: false }),
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          Vary: 'Origin',
        },
        status: 403,
      },
    )
  }

  return request.method === 'OPTIONS'
    ? new Response('ok', { headers: getCorsHeaders(request) })
    : null
}
