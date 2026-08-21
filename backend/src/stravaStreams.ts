import type { ActivityRecord } from './activityRecord'
import { finiteNumber } from './activityRecord'

type StreamPayload = {
  data?: unknown
  type?: string
}

function streamData(raw: unknown): unknown[] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const data = (raw as StreamPayload).data
  return Array.isArray(data) ? data : undefined
}

/** Normalize Strava stream responses (array or key_by_type object). */
export function normalizeStravaStreams(raw: unknown): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue
      const type = String((entry as StreamPayload).type || '')
      const data = streamData(entry)
      if (type && data) out[type] = data
    }
    return out
  }
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const data = streamData(value) ?? (Array.isArray(value) ? value : undefined)
    if (data) out[key] = data
  }
  return out
}

export function recordsFromStravaStreams(raw: unknown): ActivityRecord[] {
  const streams = normalizeStravaStreams(raw)
  const time = streams.time
  const latlng = streams.latlng
  const distance = streams.distance
  const altitude = streams.altitude
  const velocity = streams.velocity_smooth
  const heartrate = streams.heartrate
  const watts = streams.watts

  const length = Math.max(
    time?.length || 0,
    latlng?.length || 0,
    distance?.length || 0,
    altitude?.length || 0,
    velocity?.length || 0,
    heartrate?.length || 0,
    watts?.length || 0,
  )
  if (length < 1) return []

  const records: ActivityRecord[] = []
  for (let index = 0; index < length; index += 1) {
    const elapsed =
      finiteNumber(time?.[index]) ??
      (length === 1 ? 0 : Math.round((index / Math.max(1, length - 1)) * (finiteNumber(time?.[length - 1]) || length)))
    const pair = latlng?.[index]
    let latitude: number | undefined
    let longitude: number | undefined
    if (Array.isArray(pair) && pair.length >= 2) {
      latitude = finiteNumber(pair[0])
      longitude = finiteNumber(pair[1])
    }
    const speedMs = finiteNumber(velocity?.[index])
    const heartRateBpm = finiteNumber(heartrate?.[index])
    const altitudeM = finiteNumber(altitude?.[index])
    const powerW = finiteNumber(watts?.[index])
    const distanceM = finiteNumber(distance?.[index])

    if (
      latitude === undefined &&
      longitude === undefined &&
      heartRateBpm === undefined &&
      speedMs === undefined &&
      powerW === undefined &&
      distanceM === undefined
    ) {
      continue
    }

    records.push({
      elapsedSeconds: Math.max(0, elapsed ?? index),
      ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
      ...(heartRateBpm !== undefined ? { heartRateBpm } : {}),
      ...(speedMs !== undefined ? { speedKmh: speedMs * 3.6 } : {}),
      ...(altitudeM !== undefined ? { altitudeM } : {}),
      ...(powerW !== undefined ? { powerW } : {}),
      ...(distanceM !== undefined ? { distanceM } : {}),
    })
  }
  return records
}

export function streamRecordsAreRicher(streamRecords: ActivityRecord[], fallback: ActivityRecord[]): boolean {
  if (streamRecords.length === 0) return false
  if (fallback.length === 0) return true
  const streamHasMetrics = streamRecords.some(
    (record) =>
      record.heartRateBpm !== undefined ||
      record.speedKmh !== undefined ||
      record.powerW !== undefined ||
      record.distanceM !== undefined,
  )
  if (streamHasMetrics) return true
  const streamGps = streamRecords.filter((r) => r.latitude !== undefined && r.longitude !== undefined).length
  const fallbackGps = fallback.filter((r) => r.latitude !== undefined && r.longitude !== undefined).length
  return streamGps >= fallbackGps && streamGps >= 2
}
