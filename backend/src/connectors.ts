import { json } from './http'
import { status as polarStatus, sync as polarSync } from './polar'
import { status as stravaStatus, sync as stravaSync } from './strava'
import type { Env } from './types'

export const connectorRegistry = [{ id: 'polar', name: 'Polar' }, { id: 'strava', name: 'Strava' }] as const

function sessionMap(request: Request): Record<string, string> {
  try { return JSON.parse(request.headers.get('X-Connector-Sessions') || '{}') as Record<string, string> } catch { return {} }
}

function headerOnlyRequest(request: Request, headers: Headers): Request {
  return new Request(request.url, { method: 'GET', headers })
}

export async function listStatus(request: Request, env: Env) {
  const sessions = sessionMap(request)
  const polarHeaders = new Headers(request.headers); polarHeaders.set('X-Polar-Session', sessions.polar || '')
  const stravaHeaders = new Headers(request.headers)
  const polar = await polarStatus(headerOnlyRequest(request, polarHeaders), env)
  const strava = await stravaStatus(headerOnlyRequest(request, stravaHeaders), env)
  const polarConnected = Boolean((await polar.json() as { connected?: boolean }).connected)
  const stravaConnected = Boolean((await strava.json() as { connected?: boolean }).connected)
  return json({ connectors: connectorRegistry.map(item => ({ ...item, connected: item.id === 'polar' ? polarConnected : stravaConnected, active: true })) }, 200, request, env)
}

export async function syncAll(request: Request, env: Env) {
  const body = await request.json().catch(() => ({})) as { active?: string[] }
  const active = new Set(body.active || [])
  const sessions = sessionMap(request)
  const results: { connector: string; workouts: unknown[]; error?: string }[] = []
  if (active.has('polar')) {
    const headers = new Headers(request.headers); headers.set('X-Polar-Session', sessions.polar || '')
    try {
      const response = await polarSync(headerOnlyRequest(request, headers), env)
      const result = await response.json() as { workouts?: unknown[]; detail?: string }
      results.push({ connector: 'polar', workouts: result.workouts || [], ...(response.ok ? {} : { error: result.detail || 'Polar-Sync fehlgeschlagen.' }) })
    } catch (error) { results.push({ connector: 'polar', workouts: [], error: error instanceof Error ? error.message : 'Polar-Sync fehlgeschlagen.' }) }
  }
  if (active.has('strava')) {
    try {
      const response = await stravaSync(headerOnlyRequest(request, new Headers(request.headers)), env)
      const result = await response.json() as { workouts?: unknown[]; detail?: string }
      results.push({ connector: 'strava', workouts: result.workouts || [], ...(response.ok ? {} : { error: result.detail || 'Strava-Sync fehlgeschlagen.' }) })
    } catch (error) { results.push({ connector: 'strava', workouts: [], error: error instanceof Error ? error.message : 'Strava-Sync fehlgeschlagen.' }) }
  }
  return json({ results }, 200, request, env)
}
