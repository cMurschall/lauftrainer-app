import { z } from 'zod'
import packageJson from '../package.json'

export interface Env {
  GEMINI_API_KEY: string
  GEMINI_MODEL?: string
  ALLOWED_ORIGIN?: string
  FRONTEND_URL?: string
  POLAR_CLIENT_ID?: string
  POLAR_CLIENT_SECRET?: string
  POLAR_REDIRECT_URI?: string
}

const trainingRequestSchema = z.object({
  config: z.record(z.unknown()),
  workouts: z.array(z.record(z.unknown())).max(14).default([])
})

const trainingStepSchema = z.object({
  step_duration: z.string(),
  step_intensity: z.string(),
  step_instruction: z.string()
})

const trainingDaySchema = z.object({
  day: z.string(),
  sport: z.string(),
  description: z.string(),
  target_focus: z.string(),
  total_duration_minutes: z.number().int().nonnegative(),
  workout_steps: z.array(trainingStepSchema)
})

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim())
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  }
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookies = request.headers.get('Cookie')?.split(';') || []
  const entry = cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${name}=`))
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=None`
}

function polarRedirectUri(request: Request, env: Env): string {
  return env.POLAR_REDIRECT_URI || `${new URL(request.url).origin}/api/polar/callback`
}

function requirePolarConfig(env: Env): string | Response {
  if (!env.POLAR_CLIENT_ID || !env.POLAR_CLIENT_SECRET) return new Response('Polar ist im Backend noch nicht konfiguriert.', { status: 503 })
  return env.POLAR_CLIENT_ID
}

function connectPolar(request: Request, env: Env): Response {
  const clientId = requirePolarConfig(env)
  if (clientId instanceof Response) return clientId
  const state = crypto.randomUUID()
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: polarRedirectUri(request, env), scope: 'accesslink.read_all', state })
  const response = Response.redirect(`https://flow.polar.com/oauth2/authorization?${params}`, 302)
  response.headers.append('Set-Cookie', cookie('polar_oauth_state', state, 600))
  return response
}

async function polarCallback(request: Request, env: Env): Promise<Response> {
  const clientId = requirePolarConfig(env)
  if (clientId instanceof Response) return clientId
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state || state !== cookieValue(request, 'polar_oauth_state')) return new Response('Ungültiger oder abgelaufener Polar-OAuth-Status.', { status: 400 })
  const basic = btoa(`${clientId}:${env.POLAR_CLIENT_SECRET}`)
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: polarRedirectUri(request, env) })
  const tokenResponse = await fetch('https://polarremote.com/v2/oauth2/token', { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body })
  if (!tokenResponse.ok) return new Response('Polar-Token konnte nicht abgerufen werden.', { status: 502 })
  const token = await tokenResponse.json() as { access_token?: string; x_user_id?: string }
  if (!token.access_token) return new Response('Polar lieferte keinen Access-Token.', { status: 502 })
  const frontend = env.FRONTEND_URL || 'https://lauftrainer-app.pages.dev'
  const response = Response.redirect(`${frontend}?polar=connected`, 302)
  response.headers.append('Set-Cookie', cookie('polar_oauth_state', '', 0))
  response.headers.append('Set-Cookie', cookie('polar_token', JSON.stringify(token), 31536000))
  return response
}

function json(data: unknown, status: number, request: Request, env: Env): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json' } })
}

async function createTrainingPlan(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) return json({ detail: 'GEMINI_API_KEY ist nicht konfiguriert.' }, 503, request, env)

  const rawBody = await request.text()
  if (rawBody.length > 128 * 1024) return json({ detail: 'Request ist zu groß.' }, 413, request, env)
  const parsedRequest = trainingRequestSchema.safeParse(JSON.parse(rawBody) as unknown)
  if (!parsedRequest.success) return json({ detail: 'Ungültige Trainingsdaten.', issues: parsedRequest.error.issues }, 400, request, env)

  const prompt = [
    'Erstelle einen sicheren, realistischen 7-Tage-Lauftrainingsplan.',
    'Nutze ausschließlich die angegebenen Herzfrequenzzonen.',
    'Gib ausschließlich ein JSON-Array zurück, ohne Markdown oder zusätzliche Erklärung.',
    '',
    `ATHLET: ${JSON.stringify(parsedRequest.data.config)}`,
    `TRAININGSHISTORIE: ${JSON.stringify(parsedRequest.data.workouts)}`
  ].join('\n')

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash'
  const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
    signal: AbortSignal.timeout(45_000)
  })
  if (!geminiResponse.ok) return json({ detail: `Gemini antwortete mit ${geminiResponse.status}.` }, 502, request, env)

  const payload = await geminiResponse.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini lieferte keinen Text zurück.')
  const plan = z.array(trainingDaySchema).min(1).parse(JSON.parse(text))
  return json({ plan }, 200, request, env)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    const url = new URL(request.url)
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json({ status: 'ok', version: packageJson.version }, 200, request, env)
      if (request.method === 'GET' && url.pathname === '/api/polar/connect') return connectPolar(request, env)
      if (request.method === 'GET' && url.pathname === '/api/polar/callback') return await polarCallback(request, env)
      if (request.method === 'GET' && url.pathname === '/api/polar/status') return json({ connected: Boolean(cookieValue(request, 'polar_token')) }, 200, request, env)
      if (request.method === 'POST' && url.pathname === '/api/training-plan') return await createTrainingPlan(request, env)
      return json({ detail: 'Not found' }, 404, request, env)
    } catch (error) {
      console.error('Worker error:', error)
      return json({ detail: 'KI-Aufruf konnte nicht verarbeitet werden.' }, 502, request, env)
    }
  }
}
