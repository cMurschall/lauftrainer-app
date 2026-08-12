import type { Workout } from '../types/workout'

const API_URL = import.meta.env.VITE_AI_API_URL || '/api'
const API_ROOT = API_URL.replace(/\/api\/?$/, '')

export function polarConnectUrl(): string { return `${API_ROOT}/api/polar/connect` }

export async function polarStatus(): Promise<boolean> {
  const response = await fetch(`${API_ROOT}/api/polar/status`, { credentials: 'include' })
  if (!response.ok) return false
  return Boolean((await response.json() as { connected?: boolean }).connected)
}

export async function syncPolarWorkouts(): Promise<Workout[]> {
  const response = await fetch(`${API_ROOT}/api/polar/sync`, { method: 'POST', credentials: 'include' })
  const result = await response.json() as { workouts?: Workout[]; detail?: string }
  if (!response.ok) throw new Error(result.detail || 'Polar-Synchronisierung fehlgeschlagen.')
  return result.workouts || []
}
