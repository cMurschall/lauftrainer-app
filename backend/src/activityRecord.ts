/** Shared connector record shape mirrored by the frontend ActivityRecord. */
export type ActivityRecord = {
  elapsedSeconds: number
  heartRateBpm?: number
  speedKmh?: number
  altitudeM?: number
  powerW?: number
  distanceM?: number
  latitude?: number
  longitude?: number
}

export function finiteNumber(value: unknown): number | undefined {
  const result = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(result) ? result : undefined
}
