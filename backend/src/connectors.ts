import { json } from './http'
import { status as polarStatus, sync as polarSync } from './polar'
import type { Env } from './types'

export const connectorRegistry = [{ id: 'polar', name: 'Polar' }] as const

function sessionMap(request: Request): Record<string, string> {
  try { return JSON.parse(request.headers.get('X-Connector-Sessions') || '{}') as Record<string, string> } catch { return {} }
}

export async function listStatus(request: Request, env: Env) {
  const sessions = sessionMap(request)
  const polar = await polarStatus(new Request(request, { headers: { ...Object.fromEntries(request.headers), 'X-Polar-Session': sessions.polar || '' } }), env)
  const connected = Boolean((await polar.json() as { connected?: boolean }).connected)
  return json({ connectors: connectorRegistry.map(item => ({ ...item, connected, active: true })) }, 200, request, env)
}

export async function syncAll(request: Request, env: Env) {
  const body = await request.json().catch(() => ({})) as { active?: string[] }
  const active = new Set(body.active || [])
  const sessions = sessionMap(request)
  const results: { connector: string; workouts: unknown[]; error?: string }[] = []
  if (active.has('polar')) {
    const headers = new Headers(request.headers); headers.set('X-Polar-Session', sessions.polar || '')
    try {
      const response = await polarSync(new Request(request, { headers }), env)
      const result = await response.json() as { workouts?: unknown[]; detail?: string }
      results.push({ connector: 'polar', workouts: result.workouts || [], ...(response.ok ? {} : { error: result.detail || 'Polar-Sync fehlgeschlagen.' }) })
    } catch (error) { results.push({ connector: 'polar', workouts: [], error: error instanceof Error ? error.message : 'Polar-Sync fehlgeschlagen.' }) }
  }
  return json({ results }, 200, request, env)
}
