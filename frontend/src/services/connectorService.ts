import type { Workout } from '../types/workout'
import type { ConnectorId, ConnectorSettings } from '../types/settings'
import { API_ROOT } from './api'

const SESSION_KEY = 'lauftrainer-connector-sessions'

type SessionMap = Partial<Record<ConnectorId, string>>

function sessions(): SessionMap {
  try {
    const current = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') as SessionMap
    const legacy = localStorage.getItem('lauftrainer-polar-session')
    if (!current.polar && legacy) {
      current.polar = legacy
      localStorage.setItem(SESSION_KEY, JSON.stringify(current))
    }
    return current
  } catch {
    return {}
  }
}

function headers(): HeadersInit {
  return { 'Content-Type': 'application/json', 'X-Connector-Sessions': JSON.stringify(sessions()) }
}

export function captureConnectorSession(): void {
  const params = new URLSearchParams(window.location.search)
  const sessionId = params.get('connector_session') || params.get('polar_session')
  const connector = (params.get('connector') || 'polar') as ConnectorId
  if (!sessionId) return
  const stored = sessions()
  stored[connector] = sessionId
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored))
  params.delete('connector_session')
  params.delete('polar_session')
  params.delete('connector')
  params.delete('polar')
  const query = params.toString()
  window.history.replaceState(
    {},
    document.title,
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  )
}

export function connectorConnectUrl(id: ConnectorId): string {
  return `${API_ROOT}/api/connectors/${id}/connect`
}

export async function disconnectConnector(id: ConnectorId): Promise<void> {
  const stored = sessions()
  const response = await fetch(`${API_ROOT}/api/connectors/${id}/disconnect`, {
    method: 'POST',
    headers: headers(),
  })
  if (!response.ok) throw new Error('Connector konnte serverseitig nicht getrennt werden.')
  delete stored[id]
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored))
  if (id === 'polar') localStorage.removeItem('lauftrainer-polar-session')
}

export async function connectorStatus(): Promise<ConnectorSettings[]> {
  const response = await fetch(`${API_ROOT}/api/connectors/status`, { headers: headers() })
  if (!response.ok) throw new Error('Connector-Status konnte nicht geladen werden.')
  return ((await response.json()) as { connectors: ConnectorSettings[] }).connectors
}

export async function syncActiveConnectors(active: ConnectorId[]): Promise<
  {
    connector: ConnectorId
    workouts: Workout[]
    error?: string
  }[]
> {
  const response = await fetch(`${API_ROOT}/api/connectors/sync`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ active }),
  })
  const result = (await response.json()) as {
    results?: { connector: ConnectorId; workouts?: Workout[]; error?: string }[]
    detail?: string
  }
  if (!response.ok) throw new Error(result.detail || 'Synchronisierung fehlgeschlagen.')
  return (result.results || []).map((item) => ({
    connector: item.connector,
    workouts: item.workouts || [],
    error: item.error,
  }))
}
