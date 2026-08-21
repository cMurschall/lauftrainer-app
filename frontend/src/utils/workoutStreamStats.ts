import type { ActivityRecord, Workout } from '../types/workout'

export type WorkoutStreamStats = {
  hrMin?: number
  hrMax?: number
  hrAvg?: number
  hrSampleCount: number
  paceAvgSecondsPerKm?: number
  paceBestSecondsPerKm?: number
  speedSampleCount: number
  /** 0–100; share of pace (or HR) samples within ±8% of median. */
  steadinessPct?: number
  /** Cardiac decoupling %; only set when gated criteria pass. */
  decouplingPct?: number
  chartLabels: string[]
  chartElapsedSeconds: number[]
  chartHeartRate: Array<number | null>
  chartPaceMinPerKm: Array<number | null>
}

const STEADINESS_BAND = 0.08
const STEADINESS_MIN_SAMPLES = 30
const DECOUPLE_MIN_DURATION_S = 45 * 60
const DECOUPLE_MIN_STEADINESS = 70
const CHART_MAX_POINTS = 80

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function mean(values: number[]): number | undefined {
  if (!values.length) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Pace as seconds/km from speed km/h. */
export function paceSecondsFromSpeedKmh(speedKmh: number): number | undefined {
  if (!Number.isFinite(speedKmh) || speedKmh <= 0.2) return undefined
  return (3600 / speedKmh)
}

export function formatPaceMinutes(secondsPerKm: number): number {
  return secondsPerKm / 60
}

function steadinessPctFromValues(values: number[]): number | undefined {
  if (values.length < STEADINESS_MIN_SAMPLES) return undefined
  const med = median(values)
  if (med === undefined || med <= 0) return undefined
  const inBand = values.filter((value) => Math.abs(value - med) / med <= STEADINESS_BAND).length
  return Math.round((100 * inBand) / values.length)
}

/**
 * Trim outer 10% by time, split remaining into halves, compare efficiency = speed/HR.
 * Positive % ≈ more HR per speed in second half (classic aerobic decoupling).
 */
export function computeDecouplingPct(
  records: ActivityRecord[],
  durationSeconds: number,
): number | undefined {
  if (durationSeconds < DECOUPLE_MIN_DURATION_S) return undefined
  const paired = records
    .map((record) => {
      const hr = record.heartRateBpm
      const speed = record.speedKmh
      const t = record.elapsedSeconds
      if (!finite(hr) || hr < 50 || !finite(speed) || speed <= 0.2 || !finite(t)) return undefined
      return { t, hr, speed, ef: speed / hr }
    })
    .filter((row): row is { t: number; hr: number; speed: number; ef: number } => Boolean(row))
  if (paired.length < STEADINESS_MIN_SAMPLES) return undefined

  const tMin = paired[0].t
  const tMax = paired[paired.length - 1].t
  const span = Math.max(1, tMax - tMin)
  const trim = span * 0.1
  const core = paired.filter((row) => row.t >= tMin + trim && row.t <= tMax - trim)
  if (core.length < 20) return undefined
  const mid = (core[0].t + core[core.length - 1].t) / 2
  const first = core.filter((row) => row.t < mid)
  const second = core.filter((row) => row.t >= mid)
  const ef1 = mean(first.map((row) => row.ef))
  const ef2 = mean(second.map((row) => row.ef))
  if (ef1 === undefined || ef2 === undefined || ef1 <= 0) return undefined
  // Rising HR relative to speed ⇒ falling EF ⇒ positive decoupling when inverted:
  // (Ef1 - Ef2) / Ef1 so + means classic cardiac drift.
  return Math.round((((ef1 - ef2) / ef1) * 100) * 10) / 10
}

function downsampleIndices(length: number, maxPoints: number): number[] {
  if (length <= maxPoints) return Array.from({ length }, (_, index) => index)
  if (maxPoints <= 1) return [0]
  const indices: number[] = []
  for (let sample = 0; sample < maxPoints; sample += 1) {
    indices.push(Math.round((sample / (maxPoints - 1)) * (length - 1)))
  }
  return [...new Set(indices)]
}

function minuteLabel(elapsedSeconds: number): string {
  const minutes = Math.max(0, Math.round(elapsedSeconds / 60))
  return `${minutes}'`
}

export function resolveDisplayPaceSeconds(
  workout: Pick<Workout, 'averagePaceSecondsPerKm' | 'averageSpeedKmh' | 'distanceKm' | 'durationSeconds'>,
  streamPaceAvg?: number,
): number | undefined {
  if (finite(workout.averagePaceSecondsPerKm) && workout.averagePaceSecondsPerKm! > 0) {
    return workout.averagePaceSecondsPerKm
  }
  if (finite(streamPaceAvg) && streamPaceAvg! > 0) return streamPaceAvg
  if (finite(workout.averageSpeedKmh) && workout.averageSpeedKmh! > 0.2) {
    return paceSecondsFromSpeedKmh(workout.averageSpeedKmh!)
  }
  if (
    finite(workout.distanceKm) &&
    workout.distanceKm! > 0 &&
    finite(workout.durationSeconds) &&
    workout.durationSeconds > 0
  ) {
    return workout.durationSeconds / workout.distanceKm!
  }
  return undefined
}

export function computeWorkoutStreamStats(
  workout: Pick<Workout, 'durationSeconds' | 'records'>,
): WorkoutStreamStats {
  const records = workout.records || []
  const heartRates = records.map((r) => r.heartRateBpm).filter(finite)
  const speeds = records.map((r) => r.speedKmh).filter((v): v is number => finite(v) && v > 0.2)
  const paces = speeds
    .map((speed) => paceSecondsFromSpeedKmh(speed))
    .filter((v): v is number => finite(v))

  const hrMin = heartRates.length ? Math.min(...heartRates) : undefined
  const hrMax = heartRates.length ? Math.max(...heartRates) : undefined
  const hrAvg = mean(heartRates)
  const paceAvgSecondsPerKm = mean(paces)
  const paceBestSecondsPerKm = paces.length ? Math.min(...paces) : undefined

  const steadinessSource = paces.length >= STEADINESS_MIN_SAMPLES ? paces : heartRates
  const steadinessPct = steadinessPctFromValues(steadinessSource)

  let decouplingPct: number | undefined
  if (
    heartRates.length >= STEADINESS_MIN_SAMPLES &&
    speeds.length >= STEADINESS_MIN_SAMPLES &&
    (steadinessPct ?? 0) >= DECOUPLE_MIN_STEADINESS
  ) {
    decouplingPct = computeDecouplingPct(records, workout.durationSeconds)
  }

  const indices = downsampleIndices(records.length, CHART_MAX_POINTS)
  const chartLabels: string[] = []
  const chartElapsedSeconds: number[] = []
  const chartHeartRate: Array<number | null> = []
  const chartPaceMinPerKm: Array<number | null> = []

  for (const index of indices) {
    const record = records[index]
    const elapsed = finite(record?.elapsedSeconds) ? record.elapsedSeconds : index
    chartElapsedSeconds.push(elapsed)
    chartLabels.push(minuteLabel(elapsed))
    chartHeartRate.push(finite(record?.heartRateBpm) ? record.heartRateBpm! : null)
    const paceSec = finite(record?.speedKmh) ? paceSecondsFromSpeedKmh(record.speedKmh!) : undefined
    chartPaceMinPerKm.push(paceSec !== undefined ? formatPaceMinutes(paceSec) : null)
  }

  return {
    hrMin: hrMin !== undefined ? Math.round(hrMin) : undefined,
    hrMax: hrMax !== undefined ? Math.round(hrMax) : undefined,
    hrAvg: hrAvg !== undefined ? Math.round(hrAvg) : undefined,
    hrSampleCount: heartRates.length,
    paceAvgSecondsPerKm,
    paceBestSecondsPerKm,
    speedSampleCount: speeds.length,
    steadinessPct,
    decouplingPct,
    chartLabels,
    chartElapsedSeconds,
    chartHeartRate,
    chartPaceMinPerKm,
  }
}
