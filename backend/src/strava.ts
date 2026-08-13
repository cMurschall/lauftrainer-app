import type { Env } from './types'
import { json } from './http'

type StravaToken = { access_token: string; refresh_token?: string; expires_at?: number; scope?: string }

function redirectUri(request: Request, env: Env) {
  return env.STRAVA_REDIRECT_URI || `${new URL(request.url).origin}/api/connectors/strava/callback`
}

function clientConfig(env: Env): { id: string; secret: string } | Response {
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) return new Response('Strava ist im Backend noch nicht konfiguriert.', { status: 503 })
  return { id: env.STRAVA_CLIENT_ID, secret: env.STRAVA_CLIENT_SECRET }
}

export async function connect(request: Request, env: Env): Promise<Response> {
  const config = clientConfig(env); if (config instanceof Response) return config
  const state = crypto.randomUUID()
  await env.POLAR_SESSIONS.put(`strava-oauth-state:${state}`, '1', { expirationTtl: 600 })
  const params = new URLSearchParams({ client_id: config.id, response_type: 'code', redirect_uri: redirectUri(request, env), approval_prompt: 'force', scope: 'read,activity:read_all', state })
  return Response.redirect(`https://www.strava.com/oauth/authorize?${params}`, 302)
}

async function exchange(request: Request, env: Env, values: Record<string, string>): Promise<StravaToken | Response> {
  const config = clientConfig(env); if (config instanceof Response) return config
  const response = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.id, client_secret: config.secret, ...values }) })
  if (!response.ok) return new Response('Strava-Token konnte nicht abgerufen werden.', { status: 502 })
  const token = await response.json() as Partial<StravaToken>
  if (!token.access_token) return new Response('Strava lieferte keinen Access-Token.', { status: 502 })
  return token as StravaToken
}

export async function callback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), code = url.searchParams.get('code'), state = url.searchParams.get('state')
  if (url.searchParams.get('error')) return Response.redirect(`${env.FRONTEND_URL || 'https://lauftrainer-app.pages.dev'}?connector=strava&connector_error=denied`, 302)
  if (!code || !state || !(await env.POLAR_SESSIONS.get(`strava-oauth-state:${state}`))) return new Response('Ungültiger oder abgelaufener Strava-OAuth-Status.', { status: 400 })
  await env.POLAR_SESSIONS.delete(`strava-oauth-state:${state}`)
  const token = await exchange(request, env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(request, env) })
  if (token instanceof Response) return token
  const sessionId = crypto.randomUUID()
  await env.POLAR_SESSIONS.put(`strava-session:${sessionId}`, JSON.stringify(token), { expirationTtl: 60 * 60 * 24 * 30 })
  return Response.redirect(`${env.FRONTEND_URL || 'https://lauftrainer-app.pages.dev'}?connector=strava&connector_session=${sessionId}`, 302)
}

async function token(request: Request, env: Env): Promise<StravaToken | undefined> {
  let sessionId: string | undefined
  try { sessionId = (JSON.parse(request.headers.get('X-Connector-Sessions') || '{}') as Record<string, string>).strava } catch { /* use refresh-token fallback */ }
  if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
    const raw = await env.POLAR_SESSIONS.get(`strava-session:${sessionId}`)
    if (raw) try { const stored = JSON.parse(raw) as StravaToken; if (stored.access_token) return stored } catch { /* continue */ }
  }
  if (!env.STRAVA_REFRESH_TOKEN) return undefined
  const refreshed = await exchange(request, env, { grant_type: 'refresh_token', refresh_token: env.STRAVA_REFRESH_TOKEN })
  return refreshed instanceof Response ? undefined : refreshed
}

export async function status(request: Request, env: Env) {
  return json({ connected: Boolean(await token(request, env)) }, 200, request, env)
}

function number(value: unknown) { const result = typeof value === 'number' ? value : Number(value); return Number.isFinite(result) ? result : undefined }

function workout(activity: Record<string, unknown>) {
  const distance = number(activity.distance)
  return { id: `strava-${String(activity.id)}`, source: 'strava', name: String(activity.name || 'Strava workout'), sport: String(activity.type || 'RUN'), date: String(activity.start_date || new Date().toISOString()), durationSeconds: number(activity.elapsed_time), distanceKm: distance === undefined ? undefined : distance / 1000, averageHeartRate: number(activity.average_heartrate), calories: number(activity.calories), records: [], importedAt: new Date().toISOString() }
}

export async function sync(request: Request, env: Env): Promise<Response> {
  const access = await token(request, env); if (!access) return json({ detail: 'Strava ist nicht verbunden.' }, 401, request, env)
  const activities: Record<string, unknown>[] = []
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`, { headers: { Authorization: `Bearer ${access.access_token}`, Accept: 'application/json' } })
    if (!response.ok) return json({ detail: `Strava-Trainings konnten nicht geladen werden (${response.status}).` }, 502, request, env)
    const batch = await response.json() as unknown[]; activities.push(...batch as Record<string, unknown>[])
    if (batch.length < 200) break
  }
  return json({ workouts: activities.map(workout), count: activities.length }, 200, request, env)
}
