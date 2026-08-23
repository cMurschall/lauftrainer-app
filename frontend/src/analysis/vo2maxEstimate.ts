import type { ActivityRecord, UserConfig, Workout } from '../types/workout'
import { isPlausibleHeartRate, isPlausibleSpeedKmh } from '../utils/streamPlausibility'

function isRunning(sport: string): boolean {
  const value = (sport || '').trim().toLowerCase()
  return ['running', 'run', 'jogging'].includes(value)
}

function toDateKey(value: string): string {
  const dmy = value.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

export interface Vo2maxPoint {
  date: string
  vo2max: number
  workoutId: string
}

export interface Vo2maxEstimateResult {
  points: Vo2maxPoint[]
  /** Rolling median of recent valid runs (ml/kg/min). */
  latest?: number
  /** Change vs ~8 weeks earlier (ml/kg/min), when enough history exists. */
  trendDelta?: number
}

const MIN_DURATION_SECONDS = 20 * 60
const MIN_VALID_SAMPLES = 20
const HRR_MIN = 0.5
const HRR_MAX = 0.9
const VO2MAX_MIN = 25
const VO2MAX_MAX = 85
const TREND_WINDOW = 8
const TREND_LOOKBACK_DAYS = 56
const GRADE_MAX = 0.25

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Flat ACSM running cost; optional grade term when elevation deltas look plausible. */
export function acsmVo2MlKgMin(speedKmh: number, grade = 0): number {
  const speedMPerMin = speedKmh * (1000 / 60)
  const clampedGrade = Math.max(0, Math.min(GRADE_MAX, grade))
  return 3.5 + 0.2 * speedMPerMin + 0.9 * speedMPerMin * clampedGrade
}

function sampleSpeedKmh(
  records: ActivityRecord[],
  index: number,
  sport: string,
): { speedKmh: number; grade: number } | undefined {
  const record = records[index]
  let speedKmh: number | undefined
  if (typeof record.speedKmh === 'number' && isPlausibleSpeedKmh(record.speedKmh, sport)) {
    speedKmh = record.speedKmh
  }

  let grade = 0
  if (index > 0) {
    const prev = records[index - 1]
    const dt = record.elapsedSeconds - prev.elapsedSeconds
    const dDist =
      typeof record.distanceM === 'number' && typeof prev.distanceM === 'number'
        ? record.distanceM - prev.distanceM
        : undefined
    if (dt > 0 && dDist !== undefined && dDist > 0) {
      const derived = (dDist / dt) * 3.6
      if (speedKmh === undefined && isPlausibleSpeedKmh(derived, sport)) speedKmh = derived
      if (
        typeof record.altitudeM === 'number' &&
        typeof prev.altitudeM === 'number' &&
        Number.isFinite(record.altitudeM) &&
        Number.isFinite(prev.altitudeM)
      ) {
        const rise = record.altitudeM - prev.altitudeM
        const rawGrade = rise / dDist
        if (Number.isFinite(rawGrade) && Math.abs(rawGrade) <= GRADE_MAX) grade = Math.max(0, rawGrade)
      }
    }
  }

  if (speedKmh === undefined) return undefined
  return { speedKmh, grade }
}

/**
 * Estimate VO2max for one running workout from HR + speed samples (%HRR method).
 * Returns undefined when the stream is too short, sparse, or physiologically implausible.
 */
export function estimateWorkoutVo2max(workout: Workout, hrRest: number, hrMax: number): number | undefined {
  if (!isRunning(workout.sport)) return undefined
  if (workout.durationSeconds < MIN_DURATION_SECONDS) return undefined
  if (!(hrMax > hrRest) || hrRest < 30 || hrMax > 230) return undefined

  const records = workout.records || []
  if (records.length < MIN_VALID_SAMPLES) return undefined

  const times = records.map((r) => r.elapsedSeconds).filter((t) => Number.isFinite(t))
  if (times.length < 2) return undefined
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const span = Math.max(1, tMax - tMin)
  const trim = span * 0.1
  const coreStart = tMin + trim
  const coreEnd = tMax - trim

  const estimates: number[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const t = record.elapsedSeconds
    if (!Number.isFinite(t) || t < coreStart || t > coreEnd) continue
    const hr = record.heartRateBpm
    if (hr === undefined || !isPlausibleHeartRate(hr)) continue
    const hrr = (hr - hrRest) / (hrMax - hrRest)
    if (hrr < HRR_MIN || hrr > HRR_MAX) continue
    const motion = sampleSpeedKmh(records, index, workout.sport)
    if (!motion) continue
    const vo2 = acsmVo2MlKgMin(motion.speedKmh, motion.grade)
    const vo2max = vo2 / hrr
    if (vo2max >= VO2MAX_MIN && vo2max <= VO2MAX_MAX) estimates.push(vo2max)
  }

  if (estimates.length < MIN_VALID_SAMPLES) return undefined
  const med = median(estimates)
  return med === undefined ? undefined : round1(med)
}

export function calculateVo2maxEstimate(workouts: Workout[], config?: UserConfig): Vo2maxEstimateResult {
  const hrRest = config?.thresholds.hr_rest || 55
  const hrMax = config?.thresholds.hr_max || 186

  const points: Vo2maxPoint[] = []
  for (const workout of workouts) {
    const vo2max = estimateWorkoutVo2max(workout, hrRest, hrMax)
    const date = toDateKey(workout.date)
    if (vo2max === undefined || !date) continue
    points.push({ date, vo2max, workoutId: workout.id })
  }
  points.sort((a, b) => a.date.localeCompare(b.date) || a.workoutId.localeCompare(b.workoutId))

  if (!points.length) return { points: [] }

  const recent = points.slice(-TREND_WINDOW)
  const latest = median(recent.map((p) => p.vo2max))
  const latestRounded = latest === undefined ? undefined : round1(latest)

  let trendDelta: number | undefined
  const newestDate = points[points.length - 1].date
  const cutoff = (() => {
    const d = new Date(`${newestDate}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - TREND_LOOKBACK_DAYS)
    return d.toISOString().slice(0, 10)
  })()
  const older = points.filter((p) => p.date <= cutoff).slice(-TREND_WINDOW)
  if (older.length >= 3 && latestRounded !== undefined) {
    const olderMed = median(older.map((p) => p.vo2max))
    if (olderMed !== undefined) trendDelta = round1(latestRounded - olderMed)
  }

  return { points, latest: latestRounded, trendDelta }
}
