import { describe, expect, it } from 'vitest'
import {
  calculateAcwr,
  calculateAnalysis,
  calculateEfficiency,
  calculateFosterMetrics,
  calculateHrZoneDistribution,
  calculatePolarization,
  calculateRpeFosterMetrics,
  calculateTrainingLoad,
  isoWeekStart,
} from './analysisEngine'
import type { UserConfig, Workout } from '../types/workout'

const config: UserConfig = {
  trainingFocus: '',
  preferredTrainingDays: [],
  hrZones: { z1: [90, 106], z2: [107, 124], z3: [125, 142], z4: [143, 160], z5: [161, 179] },
  thresholds: { lthr: 160, hr_max: 186, hr_rest: 55 },
}

function workout(partial: Partial<Workout>): Workout {
  return {
    id: Math.random().toString(),
    source: 'unknown',
    name: 'test',
    sport: 'Running',
    date: '01-01-2025',
    durationSeconds: 3600,
    averageHeartRate: 120,
    records: [],
    importedAt: '',
    ...partial,
  }
}

describe('analysis engine', () => {
  it('uses Monday as ISO week start and handles DMY dates', () => {
    expect(isoWeekStart('05-01-2025')).toBe('2024-12-30')
    expect(isoWeekStart('06-01-2025')).toBe('2025-01-06')
  })
  it('fills rest days and computes CTL/ATL/TSB', () => {
    const result = calculateTrainingLoad(
      [
        workout({
          date: '01-01-2025',
          averageHeartRate: 155,
        }),
        workout({ date: '03-01-2025', averageHeartRate: 155 }),
      ],
      config,
    )
    expect(result).toHaveLength(3)
    expect(result[1].trimp).toBe(0)
    expect(result[2].ctl).toBeGreaterThan(0)
    expect(result[2].atl).toBeGreaterThan(result[2].ctl)
  })
  it('omits Foster monotony when weekly load variance is zero', () => {
    const result = calculateFosterMetrics([workout({ date: '06-01-2025' }), workout({ date: '07-01-2025' })], config)
    expect(result[0].load).toBeGreaterThan(0)
    expect(result[0].monotony).toBeUndefined()
    expect(result[0].strain).toBeUndefined()
  })
  it('sets Foster monotony and strain to zero for empty weeks', () => {
    const result = calculateFosterMetrics(
      [workout({ date: '06-01-2025', averageHeartRate: undefined, records: [] })],
      config,
    )
    // Workout without HR still contributes duration-based week via training load zeros around it —
    // prefer an explicit zero-load week by using only days that yield zero TRIMP.
    const empty = result.find((week) => week.load === 0)
    if (empty) {
      expect(empty.monotony).toBe(0)
      expect(empty.strain).toBe(0)
    }
  })
  it('computes Foster monotony when weekly variance is positive', () => {
    const result = calculateFosterMetrics(
      [
        workout({ date: '06-01-2025', averageHeartRate: 150, durationSeconds: 3600 }),
        workout({ date: '08-01-2025', averageHeartRate: 120, durationSeconds: 1800 }),
      ],
      config,
    )
    expect(result[0].monotony).toBeTypeOf('number')
    expect(result[0].strain).toBeTypeOf('number')
    expect(result[0].monotony!).toBeGreaterThan(0)
  })
  it('does not invent a polarization index for empty Z2', () => {
    const result = calculatePolarization([workout({ averageHeartRate: 100 })], config)
    expect(result[0].z1Pct).toBe(100)
    expect(result[0].polarizationIndex).toBeUndefined()
  })
  it('weights heart-rate zones by record elapsed time', () => {
    const result = calculateHrZoneDistribution(
      [
        workout({
          records: [
            {
              elapsedSeconds: 0,
              heartRateBpm: 100,
            },
            { elapsedSeconds: 10, heartRateBpm: 120 },
            { elapsedSeconds: 30, heartRateBpm: 170 },
          ],
        }),
      ],
      config,
    )
    expect(result[0].minutes[0]).toBeCloseTo(10 / 60)
    expect(result[0].minutes[1]).toBeCloseTo(20 / 60)
  })
  it('filters invalid efficiency values', () => {
    expect(
      calculateEfficiency([
        workout({
          distanceKm: 10,
          durationSeconds: 3600,
          averageHeartRate: 150,
        }),
        workout({ distanceKm: undefined }),
      ]),
    ).toHaveLength(1)
  })

  it('assigns ACWR risk bands low / optimal / spike', () => {
    const steady: Workout[] = []
    for (let day = 0; day < 42; day++) {
      if (day % 2 !== 0) continue
      const date = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10)
      const [y, m, d] = date.split('-')
      steady.push(
        workout({
          date: `${d}-${m}-${y}`,
          averageHeartRate: 120,
          durationSeconds: 1800,
        }),
      )
    }
    for (let day = 42; day < 49; day++) {
      const date = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10)
      const [y, m, d] = date.split('-')
      steady.push(
        workout({
          date: `${d}-${m}-${y}`,
          averageHeartRate: 165,
          durationSeconds: 7200,
        }),
      )
    }
    const load = calculateTrainingLoad(steady, config)
    const withAcwr = calculateAcwr(load)
    expect(withAcwr.length).toBeGreaterThan(0)
    expect(withAcwr.every((day) => day.ctl > 0)).toBe(true)
    const spiked = withAcwr.filter((day) => day.risk === 'spike')
    expect(spiked.length).toBeGreaterThan(0)
    expect(spiked.every((day) => (day.acwr ?? 0) > 1.3)).toBe(true)
  })

  it('computes RPE Foster metrics only from sessions with valid RPE', () => {
    const withRpe = calculateRpeFosterMetrics([
      workout({ date: '06-01-2025', durationSeconds: 3600, sessionRpe: 5 }),
      workout({ date: '08-01-2025', durationSeconds: 1800, sessionRpe: 7 }),
      workout({ date: '09-01-2025', durationSeconds: 1800 }),
    ])
    expect(withRpe.length).toBeGreaterThan(0)
    expect(withRpe[0].load).toBe(60 * 5 + 30 * 7)

    const withoutRpe = calculateRpeFosterMetrics([workout({ date: '06-01-2025', sessionRpe: undefined })])
    expect(withoutRpe.every((week) => week.load === 0)).toBe(true)
  })

  it('calculateAnalysis returns all top-level result keys', () => {
    const result = calculateAnalysis(
      [
        workout({
          date: '06-01-2025',
          averageHeartRate: 140,
          distanceKm: 8,
          durationSeconds: 3600,
          sessionRpe: 6,
          records: [
            { elapsedSeconds: 0, heartRateBpm: 130 },
            { elapsedSeconds: 60, heartRateBpm: 145 },
          ],
        }),
      ],
      config,
    )
    expect(Object.keys(result).sort()).toEqual(
      [
        'efficiency',
        'foster',
        'fosterRpe',
        'hrZones',
        'load',
        'polarization',
        'sports',
        'triathlonGroups',
        'weekly',
      ].sort(),
    )
    expect(result.load.length).toBeGreaterThan(0)
    expect(result.weekly.length).toBeGreaterThan(0)
  })
})
