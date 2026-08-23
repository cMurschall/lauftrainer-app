import { describe, expect, it } from 'vitest'
import type { ActivityRecord } from '../types/workout'
import {
  computeDecouplingPct,
  computeWorkoutStreamStats,
  paceSecondsFromSpeedKmh,
  resolveDisplayPaceSeconds,
} from './workoutStreamStats'

function recordsFrom(
  rows: Array<{ t: number; hr?: number; speed?: number }>,
): ActivityRecord[] {
  return rows.map((row) => ({
    elapsedSeconds: row.t,
    ...(row.hr !== undefined ? { heartRateBpm: row.hr } : {}),
    ...(row.speed !== undefined ? { speedKmh: row.speed } : {}),
  }))
}

describe('paceSecondsFromSpeedKmh', () => {
  it('converts 12 km/h to 5:00 /km', () => {
    expect(paceSecondsFromSpeedKmh(12)).toBe(300)
  })
})

describe('computeWorkoutStreamStats', () => {
  it('computes HR min/max/avg and pace from speed', () => {
    const stats = computeWorkoutStreamStats({
      durationSeconds: 600,
      records: recordsFrom([
        { t: 0, hr: 120, speed: 10 },
        { t: 60, hr: 140, speed: 12 },
        { t: 120, hr: 160, speed: 11 },
      ]),
    })
    expect(stats.hrMin).toBe(120)
    expect(stats.hrMax).toBe(160)
    expect(stats.hrAvg).toBe(140)
    expect(stats.speedSampleCount).toBe(3)
    expect(stats.paceAvgSecondsPerKm).toBeCloseTo((360 + 300 + 3600 / 11) / 3, 5)
  })

  it('scores high steadiness for flat pace and hides decoupling when short', () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      t: index * 60,
      hr: 140 + (index % 2),
      speed: 11.5 + (index % 2) * 0.05,
    }))
    const stats = computeWorkoutStreamStats({
      durationSeconds: 40 * 60,
      records: recordsFrom(rows),
    })
    expect(stats.steadinessPct).toBeGreaterThanOrEqual(90)
    expect(stats.decouplingPct).toBeUndefined()
  })

  it('reports decoupling when second half is less efficient and gates pass', () => {
    const rows: Array<{ t: number; hr: number; speed: number }> = []
    for (let index = 0; index < 60; index += 1) {
      const t = index * 60
      const firstHalf = index < 30
      rows.push({
        t,
        hr: firstHalf ? 140 : 155,
        speed: 12,
      })
    }
    const stats = computeWorkoutStreamStats({
      durationSeconds: 60 * 60,
      records: recordsFrom(rows),
    })
    expect(stats.steadinessPct).toBeGreaterThanOrEqual(70)
    expect(stats.decouplingPct).toBeGreaterThan(5)
  })

  it('downsamples chart series', () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      t: index,
      hr: 130 + (index % 10),
      speed: 11,
    }))
    const stats = computeWorkoutStreamStats({
      durationSeconds: 200,
      records: recordsFrom(rows),
    })
    expect(stats.chartHeartRate.length).toBeLessThanOrEqual(80)
    expect(stats.chartLabels.length).toBe(stats.chartHeartRate.length)
  })

  it('maps chart samples to nearest GPS coordinates', () => {
    const stats = computeWorkoutStreamStats({
      durationSeconds: 120,
      sport: 'Running',
      records: [
        { elapsedSeconds: 0, heartRateBpm: 120, latitude: 54, longitude: 10 },
        { elapsedSeconds: 60, heartRateBpm: 140 },
        { elapsedSeconds: 120, heartRateBpm: 160, latitude: 54.1, longitude: 10.1 },
      ],
    })
    expect(stats.chartCoordinates).toHaveLength(3)
    expect(stats.chartCoordinates[0]).toEqual([10, 54])
    expect(stats.chartCoordinates[1]).toEqual([10, 54])
    expect(stats.chartCoordinates[2]).toEqual([10.1, 54.1])
  })

  it('drops implausible HR and pace outliers from aggregates', () => {
    const stats = computeWorkoutStreamStats({
      durationSeconds: 300,
      sport: 'Running',
      records: recordsFrom([
        { t: 0, hr: 140, speed: 11 },
        { t: 60, hr: 300, speed: 12 },
        { t: 120, hr: 150, speed: 80 },
      ]),
    })
    expect(stats.hrMin).toBe(140)
    expect(stats.hrMax).toBe(150)
    expect(stats.speedSampleCount).toBe(2)
  })
})

describe('computeDecouplingPct', () => {
  it('returns undefined without enough paired samples', () => {
    expect(computeDecouplingPct(recordsFrom([{ t: 0, hr: 140, speed: 12 }]), 3600)).toBeUndefined()
  })
})

describe('resolveDisplayPaceSeconds', () => {
  it('prefers workout pace then stream then speed then distance', () => {
    expect(
      resolveDisplayPaceSeconds({ averagePaceSecondsPerKm: 310, durationSeconds: 1000 }, 320),
    ).toBe(310)
    expect(resolveDisplayPaceSeconds({ durationSeconds: 1000, averageSpeedKmh: 12 }, 320)).toBe(320)
    expect(resolveDisplayPaceSeconds({ durationSeconds: 1000, averageSpeedKmh: 12 })).toBe(300)
    expect(resolveDisplayPaceSeconds({ durationSeconds: 1800, distanceKm: 5 })).toBe(360)
  })
})
