import type { Workout } from '../types/workout'

const API_URL = import.meta.env.VITE_AI_API_URL || '/api'
const API_ROOT = API_URL.replace(/\/api\/?$/, '')
const SESSION_KEY = 'lauftrainer-polar-session'
function sessionHeaders(): HeadersInit { const sessionId = localStorage.getItem(SESSION_KEY); return sessionId ? { 'X-Polar-Session': sessionId } : {} }
export function capturePolarSession(): void { const params = new URLSearchParams(window.location.search); const sessionId = params.get('polar_session'); if (!sessionId) return; localStorage.setItem(SESSION_KEY, sessionId); params.delete('polar_session'); params.delete('polar'); const query = params.toString(); window.history.replaceState({}, document.title, `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`) }

export function polarConnectUrl(): string { return `${API_ROOT}/api/polar/connect` }

export async function polarStatus(): Promise<boolean> {
  const response = await fetch(`${API_ROOT}/api/polar/status`, { headers: sessionHeaders() })
  if (!response.ok) return false
  return Boolean((await response.json() as { connected?: boolean }).connected)
}

export async function syncPolarWorkouts(): Promise<Workout[]> {
  const response = await fetch(`${API_ROOT}/api/polar/sync`, { method: 'POST', headers: sessionHeaders() })
  const result = await response.json() as { workouts?: Workout[]; detail?: string }
  if (!response.ok) throw new Error(result.detail || 'Polar-Synchronisierung fehlgeschlagen.')
  return result.workouts || []
}
