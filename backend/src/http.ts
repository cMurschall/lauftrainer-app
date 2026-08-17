import type { Env } from './types'

export function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGIN || 'http://localhost:5173').split(',').map((value) => value.trim())
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, X-Polar-Session, X-Connector-Sessions, X-Wallet-Token, X-Idempotency-Key, X-Admin-Secret',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
}

export function json(data: unknown, status: number, request: Request, env: Env, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json', ...extraHeaders },
  })
}
