import type { Env } from './types'
import { json } from './http'
import { mapPool } from './mapPool'
import type { ActivityRecord } from './activityRecord'
import { finiteNumber } from './activityRecord'

function redirectUri(request: Request, env: Env) {
  return env.POLAR_REDIRECT_URI || `${new URL(request.url).origin}/api/polar/callback`
}
function polarConfig(env: Env): string | Response {
  return env.POLAR_CLIENT_ID && env.POLAR_CLIENT_SECRET
    ? env.POLAR_CLIENT_ID
    : new Response('Polar ist im Backend noch nicht konfiguriert.', { status: 503 })
}

export async function connect(request: Request, env: Env): Promise<Response> {
  const clientId = polarConfig(env)
  if (clientId instanceof Response) return clientId
  const state = crypto.randomUUID()
  await env.POLAR_SESSIONS.put(`oauth-state:${state}`, '1', { expirationTtl: 600 })
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri(request, env),
    scope: 'accesslink.read_all',
    state,
  })
  return Response.redirect(`https://flow.polar.com/oauth2/authorization?${params}`, 302)
}

export async function callback(request: Request, env: Env): Promise<Response> {
  const clientId = polarConfig(env)
  if (clientId instanceof Response) return clientId
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state || !(await env.POLAR_SESSIONS.get(`oauth-state:${state}`))) {
    return new Response('Ungültiger oder abgelaufener Polar-OAuth-Status.', { status: 400 })
  }
  await env.POLAR_SESSIONS.delete(`oauth-state:${state}`)
  const tokenResponse = await fetch('https://polarremote.com/v2/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${env.POLAR_CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(request, env),
    }),
  })
  if (!tokenResponse.ok) return new Response('Polar-Token konnte nicht abgerufen werden.', { status: 502 })
  const token = (await tokenResponse.json()) as { access_token?: string; x_user_id?: string }
  if (!token.access_token) return new Response('Polar lieferte keinen Access-Token.', { status: 502 })
  const sessionId = crypto.randomUUID()
  await env.POLAR_SESSIONS.put(`polar-session:${sessionId}`, JSON.stringify(token), {
    expirationTtl: 60 * 60 * 24 * 30,
  })
  return Response.redirect(
    `${env.FRONTEND_URL || 'https://lauftrainer-app.pages.dev'}?connector=polar&connector_session=${sessionId}`,
    302,
  )
}

async function token(request: Request, env: Env): Promise<{ access_token: string; x_user_id?: string } | undefined> {
  let sessionId = request.headers.get('X-Polar-Session')
  try {
    const map = JSON.parse(request.headers.get('X-Connector-Sessions') || '{}') as Record<string, string>
    sessionId = map.polar || sessionId
  } catch {
    /* use legacy header */
  }
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return undefined
  const raw = await env.POLAR_SESSIONS.get(`polar-session:${sessionId}`)
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as { access_token?: string; x_user_id?: string }
    return value.access_token ? (value as { access_token: string; x_user_id?: string }) : undefined
  } catch {
    return undefined
  }
}

export async function status(request: Request, env: Env) {
  return json({ connected: Boolean(await token(request, env)) }, 200, request, env)
}

function seconds(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return 0
  const match = value.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i)
  return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0
}

type PolarSampleSeries = { rateSeconds: number; values: Array<number | undefined> }

/** Polar AccessLink sample-type keys → ActivityRecord fields. */
const POLAR_SAMPLE_TYPES: Record<
  string,
  keyof Pick<ActivityRecord, 'heartRateBpm' | 'speedKmh' | 'altitudeM' | 'powerW' | 'distanceM'>
> = {
  '0': 'heartRateBpm',
  '1': 'speedKmh',
  '3': 'altitudeM',
  '4': 'powerW',
  '10': 'distanceM',
}

function parsePolarSampleSeries(samples: unknown): Partial<Record<keyof ActivityRecord, PolarSampleSeries>> {
  if (!Array.isArray(samples)) return {}
  const out: Partial<Record<keyof ActivityRecord, PolarSampleSeries>> = {}
  for (const entry of samples) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const typeKey = String(item['sample-type'] ?? item.sample_type ?? '')
    const field = POLAR_SAMPLE_TYPES[typeKey]
    if (!field) continue
    const rateSeconds = finiteNumber(item['recording-rate'] ?? item.recording_rate) || 1
    const raw = typeof item.data === 'string' ? item.data : ''
    if (!raw) continue
    const values = raw.split(',').map((part) => {
      const trimmed = part.trim()
      if (!trimmed || trimmed.toLowerCase() === 'null') return undefined
      return finiteNumber(trimmed)
    })
    if (values.length === 0) continue
    out[field] = { rateSeconds, values }
  }
  return out
}

function sampleValueAt(series: PolarSampleSeries | undefined, elapsedSeconds: number): number | undefined {
  if (!series || series.values.length === 0) return undefined
  const index = Math.min(
    series.values.length - 1,
    Math.max(0, Math.round(elapsedSeconds / Math.max(0.001, series.rateSeconds))),
  )
  return series.values[index]
}

export function recordsFromPolarRoute(item: Record<string, unknown>, workoutDurationSeconds: number): ActivityRecord[] {
  const routeCandidate = item.route ?? item.locations
  const series = parsePolarSampleSeries(item.samples)
  if (!Array.isArray(routeCandidate) || routeCandidate.length < 2) {
    // Indoor / no GPS: still emit metric timeline when samples exist.
    const primary = series.heartRateBpm || series.speedKmh || series.powerW || series.distanceM
    if (!primary) return []
    const records: ActivityRecord[] = []
    for (let index = 0; index < primary.values.length; index += 1) {
      const elapsedSeconds = Math.round(index * primary.rateSeconds)
      const heartRateBpm = sampleValueAt(series.heartRateBpm, elapsedSeconds)
      const speedKmh = sampleValueAt(series.speedKmh, elapsedSeconds)
      const altitudeM = sampleValueAt(series.altitudeM, elapsedSeconds)
      const powerW = sampleValueAt(series.powerW, elapsedSeconds)
      const distanceM = sampleValueAt(series.distanceM, elapsedSeconds)
      if (heartRateBpm === undefined && speedKmh === undefined && powerW === undefined && distanceM === undefined) {
        continue
      }
      records.push({
        elapsedSeconds,
        ...(heartRateBpm !== undefined ? { heartRateBpm } : {}),
        ...(speedKmh !== undefined ? { speedKmh } : {}),
        ...(altitudeM !== undefined ? { altitudeM } : {}),
        ...(powerW !== undefined ? { powerW } : {}),
        ...(distanceM !== undefined ? { distanceM } : {}),
      })
    }
    return records
  }

  const last = routeCandidate.length - 1
  const points: ActivityRecord[] = []
  for (let index = 0; index < routeCandidate.length; index += 1) {
    const point = routeCandidate[index] as Record<string, unknown>
    const latitude = finiteNumber(point.latitude ?? point.lat)
    const longitude = finiteNumber(point.longitude ?? point.lon ?? point.lng)
    if (latitude === undefined || longitude === undefined) continue
    const fromTime = seconds(point.time ?? point.duration)
    const elapsedSeconds =
      fromTime > 0 ? fromTime : last === 0 ? 0 : Math.round((Math.max(0, workoutDurationSeconds) * index) / last)
    const heartRateBpm = sampleValueAt(series.heartRateBpm, elapsedSeconds)
    const speedKmh = sampleValueAt(series.speedKmh, elapsedSeconds)
    const altitudeM = sampleValueAt(series.altitudeM, elapsedSeconds) ?? finiteNumber(point.altitude)
    const powerW = sampleValueAt(series.powerW, elapsedSeconds)
    const distanceM = sampleValueAt(series.distanceM, elapsedSeconds)
    points.push({
      elapsedSeconds,
      latitude,
      longitude,
      ...(heartRateBpm !== undefined ? { heartRateBpm } : {}),
      ...(speedKmh !== undefined ? { speedKmh } : {}),
      ...(altitudeM !== undefined ? { altitudeM } : {}),
      ...(powerW !== undefined ? { powerW } : {}),
      ...(distanceM !== undefined ? { distanceM } : {}),
    })
  }
  return points.length >= 2 ? points : []
}

function exerciseHasRouteFlag(item: Record<string, unknown>): boolean | undefined {
  if (typeof item.has_route === 'boolean') return item.has_route
  if (typeof item['has-route'] === 'boolean') return item['has-route']
  return undefined
}

function hasUsableSamples(item: Record<string, unknown>): boolean {
  return Array.isArray(item.samples) && item.samples.length > 0
}

function shouldFetchExerciseDetail(item: Record<string, unknown>, recordsLen: number): boolean {
  const flag = exerciseHasRouteFlag(item)
  const needsRoute = recordsLen < 2 && flag !== false
  const needsSamples = !hasUsableSamples(item)
  if (!needsRoute && !needsSamples) return false
  if (flag === true || needsSamples) return true
  const sport = String(item.sport || '').toUpperCase()
  return /RUN|RIDE|CYCL|HIKE|WALK|TRAIL|ROWING|SKI/i.test(sport)
}

async function fetchExerciseDetail(
  exerciseId: string,
  headers: HeadersInit,
): Promise<Record<string, unknown> | undefined> {
  const response = await fetch(
    `https://www.polaraccesslink.com/v3/exercises/${encodeURIComponent(exerciseId)}?route=true&samples=true`,
    { headers },
  )
  if (!response.ok) return undefined
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function mapExercise(item: Record<string, unknown>, index: number) {
  const date = String(item['start-time'] || item.start_time || item.startTime || item.date || new Date().toISOString())
  const distance = finiteNumber(item.distance)
  const ascent = finiteNumber(
    item.ascent ?? item.climbing ?? item.elevation ?? item['total-ascent'] ?? item.total_ascent ?? item.altitude,
  )
  const elevationGainM = ascent !== undefined && ascent > 0 ? ascent : undefined
  const durationSeconds = seconds(item.duration ?? item['duration-seconds'])
  const heart = item.heart_rate as Record<string, unknown> | undefined
  return {
    id: `polar-${String(item.id || item['exercise-id'] || `${date}-${index}`)}`,
    source: 'polar-json' as const,
    name: String(item.name || item.sport || 'Polar workout'),
    sport: String(item.sport || 'RUNNING'),
    date,
    durationSeconds,
    distanceKm: distance !== undefined && distance > 100 ? distance / 1000 : distance,
    averageHeartRate: finiteNumber(
      item['average-heart-rate'] ?? item.average_heart_rate ?? item.averageHeartRate ?? heart?.average,
    ),
    calories: finiteNumber(item.calories),
    ascentM: elevationGainM,
    elevationGainM,
    records: recordsFromPolarRoute(item, durationSeconds),
    importedAt: new Date().toISOString(),
  }
}

export async function sync(request: Request, env: Env): Promise<Response> {
  const access = await token(request, env)
  if (!access) return json({ detail: 'Polar ist nicht verbunden.' }, 401, request, env)
  const headers = { Authorization: `Bearer ${access.access_token}`, Accept: 'application/json' }
  if (access.x_user_id) {
    const registration = await fetch('https://www.polaraccesslink.com/v3/users', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'member-id': access.x_user_id }),
    })
    if (!registration.ok && registration.status !== 409) {
      return json(
        { detail: `Polar-Nutzer konnte nicht registriert werden (${registration.status}).` },
        502,
        request,
        env,
      )
    }
  }

  const response = await fetch('https://www.polaraccesslink.com/v3/exercises?route=true&samples=true', { headers })
  if (response.status === 204) return json({ workouts: [], count: 0 }, 200, request, env)
  if (!response.ok) {
    return json({ detail: `Polar-Trainings konnten nicht geladen werden (${response.status}).` }, 502, request, env)
  }
  const raw = (await response.json()) as unknown
  const exercises = Array.isArray(raw) ? raw : (raw as { exercises?: unknown[] }).exercises || []

  const enriched = await mapPool(exercises, 3, async (exercise) => {
    const item = exercise as Record<string, unknown>
    const durationSeconds = seconds(item.duration ?? item['duration-seconds'])
    const existingRecords = recordsFromPolarRoute(item, durationSeconds)
    const exerciseId = String(item.id || item['exercise-id'] || '')
    if (!exerciseId || !shouldFetchExerciseDetail(item, existingRecords.length)) return item

    const detail = await fetchExerciseDetail(exerciseId, headers)
    if (!detail) return item
    return {
      ...item,
      ...detail,
      route: detail.route ?? detail.locations ?? item.route,
      samples: detail.samples ?? item.samples,
    }
  })

  const workouts = enriched.map((exercise, index) => mapExercise(exercise as Record<string, unknown>, index))
  return json({ workouts, count: workouts.length }, 200, request, env)
}
