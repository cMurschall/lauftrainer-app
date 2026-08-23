import { sportKind, type SportKind } from './dashboardUi'

/** Typical sensor / physiology bounds — display & aggregates only; raw records stay in IndexedDB. */
export const HR_BPM_MIN = 40
export const HR_BPM_MAX = 220
export const SPEED_KMH_MIN = 0.2

const SPEED_KMH_MAX: Record<SportKind, number> = {
  running: 25,
  walking: 12,
  hiking: 15,
  cycling: 90,
  swimming: 10,
  other: 50,
}

export function isPlausibleHeartRate(bpm: number): boolean {
  return Number.isFinite(bpm) && bpm >= HR_BPM_MIN && bpm <= HR_BPM_MAX
}

export function isPlausibleSpeedKmh(speedKmh: number, sport?: string): boolean {
  if (!Number.isFinite(speedKmh) || speedKmh < SPEED_KMH_MIN) return false
  return speedKmh <= SPEED_KMH_MAX[sportKind(sport)]
}

export function plausibleHeartRate(bpm: number | undefined): number | undefined {
  if (bpm === undefined || !isPlausibleHeartRate(bpm)) return undefined
  return bpm
}

export function plausibleSpeedKmh(speedKmh: number | undefined, sport?: string): number | undefined {
  if (speedKmh === undefined || !isPlausibleSpeedKmh(speedKmh, sport)) return undefined
  return speedKmh
}
