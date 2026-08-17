import type { ActivityRecord, Workout } from '../types/workout'

function durationSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 10000 ? value : value * 60
  if (typeof value !== 'string') return 0
  const trimmed = value.trim()
  const iso = trimmed.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i)
  if (iso) return Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0)
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? (parsed > 10000 ? parsed : parsed * 60) : 0
}

function finiteNumber(value: unknown): number | undefined {
  const result = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(result) ? result : undefined
}

/**
 * Polar AccessLink / Flow JSON may include GPS as:
 * - `route` / `locations`: [{ latitude, longitude, time? }, ...]
 * - parallel arrays on a route object: { latitude: number[], longitude: number[] }
 */
export function recordsFromPolarRoute(
  raw: Record<string, unknown>,
  workoutDurationSeconds: number,
): ActivityRecord[] {
  const routeCandidate = raw.route ?? raw.locations ?? raw.Route ?? raw.Locations

  if (Array.isArray(routeCandidate) && routeCandidate.length >= 2) {
    const last = routeCandidate.length - 1
    const points: ActivityRecord[] = []
    for (let index = 0; index < routeCandidate.length; index += 1) {
      const point = routeCandidate[index] as Record<string, unknown>
      const latitude = finiteNumber(point.latitude ?? point.lat)
      const longitude = finiteNumber(point.longitude ?? point.lon ?? point.lng)
      if (latitude === undefined || longitude === undefined) continue
      const fromTime = durationSeconds(point.time ?? point.duration ?? point.elapsed)
      const elapsedSeconds =
        fromTime > 0
          ? fromTime
          : last === 0
            ? 0
            : Math.round((Math.max(0, workoutDurationSeconds) * index) / last)
      points.push({ elapsedSeconds, latitude, longitude })
    }
    return points.length >= 2 ? points : []
  }

  if (routeCandidate && typeof routeCandidate === 'object' && !Array.isArray(routeCandidate)) {
    const routeObject = routeCandidate as Record<string, unknown>
    const latitudes = routeObject.latitude ?? routeObject.latitudes
    const longitudes = routeObject.longitude ?? routeObject.longitudes
    if (Array.isArray(latitudes) && Array.isArray(longitudes) && latitudes.length >= 2) {
      const count = Math.min(latitudes.length, longitudes.length)
      const last = count - 1
      const points: ActivityRecord[] = []
      for (let index = 0; index < count; index += 1) {
        const latitude = finiteNumber(latitudes[index])
        const longitude = finiteNumber(longitudes[index])
        if (latitude === undefined || longitude === undefined) continue
        points.push({
          elapsedSeconds: last === 0 ? 0 : Math.round((Math.max(0, workoutDurationSeconds) * index) / last),
          latitude,
          longitude,
        })
      }
      return points.length >= 2 ? points : []
    }
  }

  return []
}

export function parsePolarJson(text: string, fileName: string): Workout {
  const raw = JSON.parse(text) as Record<string, unknown>
  const duration = durationSeconds(raw.duration ?? raw.durationSeconds ?? raw.duration_in_seconds)
  const distance = Number(raw.distance || raw.distanceKm || raw.distance_km || 0)
  const heartRate = raw.heart_rate as Record<string, unknown> | undefined
  const date = String(raw.start_time || raw.startTime || raw.date || raw.start || new Date().toISOString())
  if (!duration && !distance) throw new Error(`${fileName}: JSON enthält keine Workout-Dauer oder Distanz.`)
  const sport = String(raw.sport || 'RUNNING')
  return {
    id: `json-${String(raw.id || fileName)}-${date}`,
    source: 'polar-json',
    name: String(raw.name || fileName),
    sport,
    rawSport: sport,
    date,
    durationSeconds: duration,
    distanceKm: distance > 1000 ? distance / 1000 : distance,
    averageHeartRate:
      Number(raw.average_heart_rate || raw.averageHeartRate || raw.avg_hr || heartRate?.average) || undefined,
    calories: Number(raw.calories) || undefined,
    records: recordsFromPolarRoute(raw, duration),
    importedAt: new Date().toISOString(),
    elevationGainM: Number(raw.elevationGainM || raw.ascentM) || undefined,
    averageSpeedKmh: Number(raw.averageSpeedKmh || raw.average_speed) || undefined,
    averagePowerW: Number(raw.averagePowerW || raw.average_power) || undefined,
    swimmingDistanceM: Number(raw.swimmingDistanceM) || undefined,
    swimmingLaps: Number(raw.swimmingLaps || raw.laps) || undefined,
    swimmingStrokes: Number(raw.swimmingStrokes || raw.strokes) || undefined,
    poolLengthM: Number(raw.poolLengthM || raw.pool_length) || undefined,
  }
}
