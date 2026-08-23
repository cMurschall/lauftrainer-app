import { describe, expect, it } from 'vitest'
import type { ActivityRecord, Workout } from '../types/workout'
import { acsmVo2MlKgMin, calculateVo2maxEstimate, estimateWorkoutVo2max } from './vo2maxEstimate'

function recordsAtSteadyPace(options: {
  durationSeconds: number
  speedKmh: number
  hr: number
  intervalSeconds?: number
}): ActivityRecord[] {
  const interval = options.intervalSeconds ?? 10
  const records: ActivityRecord[] = []
  let distanceM = 0
  for (let t = 0; t <= options.durationSeconds; t += interval) {
    records.push({
      elapsedSeconds: t,
      heartRateBpm: options.hr,
      speedKmh: options.speedKmh,
      distanceM,
    })
    distanceM += (options.speedKmh * 1000 * interval) / 3600
  }
  return records
}

function runWorkout(partial: Partial<Workout> = {}): Workout {
  return {
    id: 'run-1',
    source: 'unknown',
    name: 'Steady',
    sport: 'Running',
    date: '2026-08-01',
    durationSeconds: 2400,
    distanceKm: 8,
    averageHeartRate: 145,
    records: recordsAtSteadyPace({ durationSeconds: 2400, speedKmh: 12, hr: 145 }),
    importedAt: '',
    ...partial,
  }
}

describe('vo2maxEstimate', () => {
  it('computes ACSM flat running cost', () => {
    // 12 km/h = 200 m/min → 3.5 + 0.2*200 = 43.5
    expect(acsmVo2MlKgMin(12)).toBeCloseTo(43.5, 5)
    expect(acsmVo2MlKgMin(12, 0.05)).toBeCloseTo(43.5 + 0.9 * 200 * 0.05, 5)
  })

  it('estimates VO2max from steady HR and pace via %HRR', () => {
    const hrRest = 55
    const hrMax = 186
    const workout = runWorkout()
    const estimate = estimateWorkoutVo2max(workout, hrRest, hrMax)
    expect(estimate).toBeTypeOf('number')
    // VO2 43.5 / ((145-55)/(186-55)) ≈ 43.5 / 0.687 ≈ 63.3
    expect(estimate!).toBeGreaterThan(55)
    expect(estimate!).toBeLessThan(75)
  })

  it('rejects short runs, cycling, and sparse streams', () => {
    expect(
      estimateWorkoutVo2max(
        runWorkout({
          durationSeconds: 600,
          records: recordsAtSteadyPace({ durationSeconds: 600, speedKmh: 12, hr: 145 }),
        }),
        55,
        186,
      ),
    ).toBeUndefined()
    expect(estimateWorkoutVo2max(runWorkout({ sport: 'Cycling' }), 55, 186)).toBeUndefined()
    expect(estimateWorkoutVo2max(runWorkout({ records: [] }), 55, 186)).toBeUndefined()
  })

  it('builds a time series and latest rolling median', () => {
    const early = Array.from({ length: 4 }, (_, index) =>
      runWorkout({
        id: `early-${index}`,
        date: `2026-05-${String(10 + index).padStart(2, '0')}`,
      }),
    )
    const workouts = [
      ...early,
      runWorkout({ id: 'a', date: '2026-06-01' }),
      runWorkout({ id: 'b', date: '2026-07-01' }),
      runWorkout({ id: 'c', date: '2026-08-01' }),
      runWorkout({
        id: 'd',
        date: '2026-08-10',
        records: recordsAtSteadyPace({ durationSeconds: 2400, speedKmh: 13, hr: 145 }),
      }),
    ]
    const result = calculateVo2maxEstimate(workouts, {
      trainingFocus: '',
      preferredTrainingDays: [],
      hrZones: {},
      thresholds: { hr_rest: 55, hr_max: 186, lthr: 160 },
    })
    expect(result.points.length).toBe(8)
    expect(result.latest).toBeTypeOf('number')
    expect(result.latest!).toBeGreaterThan(40)
    expect(result.trendDelta).toBeTypeOf('number')
  })

  it('returns empty result when no valid runs exist', () => {
    expect(
      calculateVo2maxEstimate([
        runWorkout({
          sport: 'Cycling',
          records: recordsAtSteadyPace({ durationSeconds: 2400, speedKmh: 25, hr: 145 }),
        }),
      ]),
    ).toEqual({ points: [] })
  })
})
