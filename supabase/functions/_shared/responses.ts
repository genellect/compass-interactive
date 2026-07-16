import { getCorsHeaders } from './cors.ts'

export function createJsonResponse(request: Request) {
  return function jsonResponse(body: Record<string, unknown>, status = 200) {
    const headers = getCorsHeaders(request)
    headers.set('Cache-Control', 'no-store')
    headers.set('Content-Type', 'application/json; charset=utf-8')
    headers.set('X-Content-Type-Options', 'nosniff')

    return new Response(JSON.stringify(body), { headers, status })
  }
}
