import type { Env } from './types'
import { json } from './http'

function redirectUri(request: Request, env: Env) { return env.POLAR_REDIRECT_URI || `${new URL(request.url).origin}/api/polar/callback` }
function polarConfig(env: Env): string | Response { return env.POLAR_CLIENT_ID && env.POLAR_CLIENT_SECRET ? env.POLAR_CLIENT_ID : new Response('Polar ist im Backend noch nicht konfiguriert.', { status: 503 }) }

export async function connect(request: Request, env: Env): Promise<Response> {
  const clientId = polarConfig(env); if (clientId instanceof Response) return clientId
  const state = crypto.randomUUID(); await env.POLAR_SESSIONS.put(`oauth-state:${state}`, '1', { expirationTtl: 600 })
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri(request, env), scope: 'accesslink.read_all', state })
  return Response.redirect(`https://flow.polar.com/oauth2/authorization?${params}`, 302)
}

export async function callback(request: Request, env: Env): Promise<Response> {
  const clientId = polarConfig(env); if (clientId instanceof Response) return clientId
  const url = new URL(request.url), code = url.searchParams.get('code'), state = url.searchParams.get('state')
  if (!code || !state || !(await env.POLAR_SESSIONS.get(`oauth-state:${state}`))) return new Response('Ungültiger oder abgelaufener Polar-OAuth-Status.', { status: 400 })
  await env.POLAR_SESSIONS.delete(`oauth-state:${state}`)
  const tokenResponse = await fetch('https://polarremote.com/v2/oauth2/token', { method: 'POST', headers: { Authorization: `Basic ${btoa(`${clientId}:${env.POLAR_CLIENT_SECRET}`)}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(request, env) }) })
  if (!tokenResponse.ok) return new Response('Polar-Token konnte nicht abgerufen werden.', { status: 502 })
  const token = await tokenResponse.json() as { access_token?: string; x_user_id?: string }; if (!token.access_token) return new Response('Polar lieferte keinen Access-Token.', { status: 502 })
  const sessionId = crypto.randomUUID(); await env.POLAR_SESSIONS.put(`polar-session:${sessionId}`, JSON.stringify(token), { expirationTtl: 60 * 60 * 24 * 30 })
  return Response.redirect(`${env.FRONTEND_URL || 'https://lauftrainer-app.pages.dev'}?polar=connected&polar_session=${sessionId}`, 302)
}

async function token(request: Request, env: Env): Promise<{ access_token: string; x_user_id?: string } | undefined> {
  const sessionId = request.headers.get('X-Polar-Session'); if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return undefined
  const raw = await env.POLAR_SESSIONS.get(`polar-session:${sessionId}`); if (!raw) return undefined
  try { const value = JSON.parse(raw) as { access_token?: string; x_user_id?: string }; return value.access_token ? value as { access_token: string; x_user_id?: string } : undefined } catch { return undefined }
}

export async function status(request: Request, env: Env) { return json({ connected: Boolean(await token(request, env)) }, 200, request, env) }

function seconds(value: unknown) { if (typeof value === 'number') return value; if (typeof value !== 'string') return 0; const match = value.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i); return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0 }
function number(value: unknown) { const result = typeof value === 'number' ? value : Number(value); return Number.isFinite(result) ? result : undefined }

export async function sync(request: Request, env: Env): Promise<Response> {
  const access = await token(request, env); if (!access) return json({ detail: 'Polar ist nicht verbunden.' }, 401, request, env)
  const headers = { Authorization: `Bearer ${access.access_token}`, Accept: 'application/json' }
  if (access.x_user_id) { const registration = await fetch('https://www.polaraccesslink.com/v3/users', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ 'member-id': access.x_user_id }) }); if (!registration.ok && registration.status !== 409) return json({ detail: `Polar-Nutzer konnte nicht registriert werden (${registration.status}).` }, 502, request, env) }
  const response = await fetch('https://www.polaraccesslink.com/v3/exercises', { headers }); if (response.status === 204) return json({ workouts: [], count: 0 }, 200, request, env); if (!response.ok) return json({ detail: `Polar-Trainings konnten nicht geladen werden (${response.status}).` }, 502, request, env)
  const raw = await response.json() as unknown, exercises = Array.isArray(raw) ? raw : (raw as { exercises?: unknown[] }).exercises || []
  const workouts = exercises.map((exercise, index) => { const item = exercise as Record<string, unknown>, date = String(item['start-time'] || item.start_time || item.startTime || item.date || new Date().toISOString()), distance = number(item.distance); return { id: `polar-${String(item.id || item['exercise-id'] || `${date}-${index}`)}`, source: 'polar-json', name: String(item.name || item.sport || 'Polar workout'), sport: String(item.sport || 'RUNNING'), date, durationSeconds: seconds(item.duration ?? item['duration-seconds']), distanceKm: distance !== undefined && distance > 100 ? distance / 1000 : distance, averageHeartRate: number(item['average-heart-rate'] ?? item.average_heart_rate ?? item.averageHeartRate), calories: number(item.calories), records: [], importedAt: new Date().toISOString() } })
  return json({ workouts, count: workouts.length }, 200, request, env)
}
