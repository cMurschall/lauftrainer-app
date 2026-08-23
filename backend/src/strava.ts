import type { Env } from './types'
import { json } from './http'
import { recordsFromPolyline } from './polyline'
import { mapPool } from './mapPool'
import { recordsFromStravaStreams, streamRecordsAreRicher } from './stravaStreams'
import type { ActivityRecord } from './activityRecord'

type StravaToken = { access_token: string; refresh_token?: string; expires_at?: number; scope?: string }

const STREAM_KEYS = 'time,latlng,distance,altitude,velocity_smooth,heartrate,watts'

/** Stay below Cloudflare Worker subrequest limits (50 free / 1000 paid). */
const STRAVA_SYNC_LIMITS = {
  auto: { maxPages: 1, maxStreamEnrichments: 12 },
  full: { maxPages: 2, maxStreamEnrichments: 40 },
} as const

type StravaSyncMode = keyof typeof STRAVA_SYNC_LIMITS

export type StravaSyncOptions = {
  syncMode?: StravaSyncMode
  /** ISO start date of the newest locally stored Strava workout — fetches only newer activities. */
  afterDate?: string
}

function redirectUri(request: Request, env: Env) {
  return env.STRAVA_REDIRECT_URI || `${new URL(request.url).origin}/api/connectors/strava/callback`
}

function clientConfig(env: Env): { id: string; secret: string } | Response {
  const id = env.STRAVA_CLIENT_ID
  const secret = env.STRAVA_CLIENT_SECRET
  const missing = [!id ? 'STRAVA_CLIENT_ID' : '', !secret ? 'STRAVA_CLIENT_SECRET' : ''].filter(Boolean)
  if (!id || !secret)
    return new Response(
      `Strava-Konfiguration unvollständig. Fehlende Variable(n): ${missing.join(', ')}. Bitte im Cloudflare-Worker unter dem Production-Environment prüfen und danach deployen.`,
      { status: 503 },
    )
  return { id, secret }
}

export async function connect(request: Request, env: Env): Promise<Response> {
  const config = clientConfig(env)
  if (config instanceof Response) return config
  const state = crypto.randomUUID()
  await env.POLAR_SESSIONS.put(`strava-oauth-state:${state}`, '1', { expirationTtl: 600 })
  const params = new URLSearchParams({
    client_id: config.id,
    response_type: 'code',
    redirect_uri: redirectUri(request, env),
    approval_prompt: 'force',
    scope: 'read,activity:read_all',
    state,
  })
  return Response.redirect(`https://www.strava.com/oauth/authorize?${params}`, 302)
}

async function exchange(request: Request, env: Env, values: Record<string, string>): Promise<StravaToken | Response> {
  const config = clientConfig(env)
  if (config instanceof Response) return config
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.id, client_secret: config.secret, ...values }),
  })
  if (!response.ok) return new Response('Strava-Token konnte nicht abgerufen werden.', { status: 502 })
  const token = (await response.json()) as Partial<StravaToken>
  if (!token.access_token) return new Response('Strava lieferte keinen Access-Token.', { status: 502 })
  return token as StravaToken
}

export async function callback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    code = url.searchParams.get('code'),
    state = url.searchParams.get('state')
  if (url.searchParams.get('error'))
    return Response.redirect(
      `${env.FRONTEND_URL || 'https://lauftrainer-app.pages.dev'}?connector=strava&connector_error=denied`,
      302,
    )
  if (!code || !state || !(await env.POLAR_SESSIONS.get(`strava-oauth-state:${state}`)))
    return new Response('Ungültiger oder abgelaufener Strava-OAuth-Status.', { status: 400 })
  await env.POLAR_SESSIONS.delete(`strava-oauth-state:${state}`)
  const token = await exchange(request, env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(request, env),
  })
  if (token instanceof Response) return token
  const sessionId = crypto.randomUUID()
  await env.POLAR_SESSIONS.put(`strava-session:${sessionId}`, JSON.stringify(token), {
    expirationTtl: 60 * 60 * 24 * 30,
  })
  return Response.redirect(
    `${env.FRONTEND_URL || 'https://lauftrainer-app.pages.dev'}?connector=strava&connector_session=${sessionId}`,
    302,
  )
}

async function token(request: Request, env: Env): Promise<StravaToken | undefined> {
  let sessionId: string | undefined
  try {
    sessionId = (JSON.parse(request.headers.get('X-Connector-Sessions') || '{}') as Record<string, string>).strava
  } catch {
    /* use refresh-token fallback */
  }
  if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
    const raw = await env.POLAR_SESSIONS.get(`strava-session:${sessionId}`)
    if (raw)
      try {
        const stored = JSON.parse(raw) as StravaToken
        if (stored.access_token) {
          // Strava access tokens expire after a few hours. Refresh shortly before
          // expiry so a previously connected device does not suddenly fail.
          if (!stored.expires_at || stored.expires_at > Math.floor(Date.now() / 1000) + 60 || !stored.refresh_token)
            return stored
          const refreshed = await exchange(request, env, {
            grant_type: 'refresh_token',
            refresh_token: stored.refresh_token,
          })
          if (!(refreshed instanceof Response)) {
            await env.POLAR_SESSIONS.put(`strava-session:${sessionId}`, JSON.stringify(refreshed), {
              expirationTtl: 60 * 60 * 24 * 30,
            })
            return refreshed
          }
          return undefined
        }
      } catch {
        /* continue */
      }
  }
  // Connector sessions are intentionally device-specific. Do not fall back to
  // a worker-wide refresh token, otherwise every new device appears connected.
  return undefined
}

export async function status(request: Request, env: Env) {
  return json({ connected: Boolean(await token(request, env)) }, 200, request, env)
}

function number(value: unknown) {
  const result = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(result) ? result : undefined
}

function activityPolyline(activity: Record<string, unknown>): string | undefined {
  const map = activity.map
  if (!map || typeof map !== 'object') return undefined
  const summary = (map as Record<string, unknown>).summary_polyline
  return typeof summary === 'string' && summary.length > 0 ? summary : undefined
}

function workoutFromActivity(activity: Record<string, unknown>, records: ActivityRecord[]) {
  const distance = number(activity.distance)
  const durationSeconds = number(activity.moving_time) ?? number(activity.elapsed_time) ?? 0
  const rawSport = String(activity.sport_type || activity.type || 'RUN')
  const sportMap: Record<string, string> = {
    Run: 'Running',
    VirtualRun: 'Running',
    Ride: 'Cycling',
    VirtualRide: 'Cycling',
    Swim: 'Swimming',
    Hike: 'Hiking',
    Walk: 'Walking',
    Triathlon: 'Triathlon',
  }
  return {
    id: `strava-${String(activity.id)}`,
    source: 'strava' as const,
    name: String(activity.name || 'Strava workout'),
    sport: sportMap[rawSport] || 'Other',
    rawSport,
    date: String(activity.start_date || new Date().toISOString()),
    durationSeconds,
    distanceKm: distance === undefined ? undefined : distance / 1000,
    averageHeartRate: number(activity.average_heartrate),
    calories: number(activity.calories),
    ascentM: number(activity.total_elevation_gain),
    elevationGainM: number(activity.total_elevation_gain),
    averageSpeedKmh: number(activity.average_speed) === undefined ? undefined : number(activity.average_speed)! * 3.6,
    maxSpeedKmh: number(activity.max_speed) === undefined ? undefined : number(activity.max_speed)! * 3.6,
    averagePowerW: number(activity.average_watts),
    maxPowerW: number(activity.max_watts),
    normalizedPowerW: number(activity.weighted_average_watts),
    records,
    importedAt: new Date().toISOString(),
  }
}

async function fetchActivityStreams(activityId: string, accessToken: string): Promise<ActivityRecord[] | undefined> {
  const response = await fetch(
    `https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}/streams?keys=${STREAM_KEYS}&key_by_type=true`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
  )
  if (response.status === 429) return undefined
  if (!response.ok) return []
  try {
    return recordsFromStravaStreams(await response.json())
  } catch {
    return []
  }
}

function afterEpochSeconds(iso?: string): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return undefined
  return Math.floor(ms / 1000)
}

export async function sync(request: Request, env: Env, options?: StravaSyncOptions): Promise<Response> {
  const access = await token(request, env)
  if (!access)
    return json(
      {
        detail:
          'Strava ist auf diesem Gerät nicht verbunden oder die Verbindung ist abgelaufen. Bitte Strava hier erneut verbinden.',
      },
      401,
      request,
      env,
    )
  const syncMode: StravaSyncMode = options?.syncMode === 'auto' ? 'auto' : 'full'
  const limits = STRAVA_SYNC_LIMITS[syncMode]
  const after = afterEpochSeconds(options?.afterDate)
  const activities: Record<string, unknown>[] = []
  for (let page = 1; page <= limits.maxPages; page += 1) {
    const params = new URLSearchParams({ per_page: '200', page: String(page) })
    if (after) params.set('after', String(after))
    const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params}`, {
      headers: { Authorization: `Bearer ${access.access_token}`, Accept: 'application/json' },
    })
    if (!response.ok)
      return json({ detail: `Strava-Trainings konnten nicht geladen werden (${response.status}).` }, 502, request, env)
    const batch = (await response.json()) as unknown[]
    activities.push(...(batch as Record<string, unknown>[]))
    if (batch.length < 200) break
    if (after) break
  }

  let streamBudget = limits.maxStreamEnrichments
  let streamsRateLimited = false
  const workouts = await mapPool(activities, 3, async (activity) => {
    const durationSeconds = number(activity.moving_time) ?? number(activity.elapsed_time) ?? 0
    const fallback = recordsFromPolyline(activityPolyline(activity), durationSeconds)
    const activityId = String(activity.id || '')
    if (!activityId || streamBudget <= 0 || streamsRateLimited) {
      return workoutFromActivity(activity, fallback)
    }
    streamBudget -= 1
    const streamRecords = await fetchActivityStreams(activityId, access.access_token)
    if (streamRecords === undefined) {
      streamsRateLimited = true
      return workoutFromActivity(activity, fallback)
    }
    const records = streamRecordsAreRicher(streamRecords, fallback) ? streamRecords : fallback
    return workoutFromActivity(activity, records)
  })

  const hitPageCap = activities.length >= limits.maxPages * 200
  const streamsEnriched = limits.maxStreamEnrichments - streamBudget
  const hitStreamCap = streamsEnriched < activities.length
  const partial = hitPageCap || hitStreamCap || streamsRateLimited

  return json(
    {
      workouts,
      count: workouts.length,
      syncMeta: {
        syncMode,
        activitiesFetched: activities.length,
        streamsEnriched,
        partial,
      },
    },
    200,
    request,
    env,
  )
}
