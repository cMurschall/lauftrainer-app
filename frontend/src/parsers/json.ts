import type { Workout } from '../types/workout'

function durationSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 10000 ? value : value * 60
  if (typeof value !== 'string') return 0
  const trimmed = value.trim()
  const iso = trimmed.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i)
  if (iso) return Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0)
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? (parsed > 10000 ? parsed : parsed * 60) : 0
}

export function parsePolarJson(text: string, fileName: string): Workout {
  const raw = JSON.parse(text) as Record<string, unknown>
  const duration = durationSeconds(raw.duration ?? raw.durationSeconds ?? raw.duration_in_seconds)
  const distance = Number(raw.distance || raw.distanceKm || raw.distance_km || 0)
  const heartRate = raw.heart_rate as Record<string, unknown> | undefined
  const date = String(raw.start_time || raw.startTime || raw.date || raw.start || new Date().toISOString())
  if (!duration && !distance) throw new Error(`${fileName}: JSON enthält keine Workout-Dauer oder Distanz.`)
  return {
    id: `json-${String(raw.id || fileName)}-${date}`,
    source: 'polar-json',
    name: String(raw.name || fileName),
    sport: String(raw.sport || 'RUNNING'),
    date,
    durationSeconds: duration,
    distanceKm: distance > 1000 ? distance / 1000 : distance,
    averageHeartRate:
      Number(raw.average_heart_rate || raw.averageHeartRate || raw.avg_hr || heartRate?.average) || undefined,
    calories: Number(raw.calories) || undefined,
    records: [],
    importedAt: new Date().toISOString(),
  }
}
