export const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
}

export function handleCors(request: Request) {
  return request.method === 'OPTIONS'
    ? new Response('ok', { headers: corsHeaders })
    : null
}
