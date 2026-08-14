import { describe, expect, it } from 'vitest'
import { mergeWorkouts, workoutIdentity } from './workoutIdentity'
import type { Workout } from '../types/workout'

function workout(partial: Partial<Workout> & Pick<Workout, 'id' | 'name'>): Workout {
  return {
    source: 'unknown',
    sport: 'Running',
    date: '2026-08-10T10:00:00.000Z',
    durationSeconds: 1800,
    records: [],
    importedAt: new Date().toISOString(),
    ...partial,
  }
}

describe('workoutIdentity', () => {
  it('maps Polar multi-format stems to the same identity', () => {
    const stem = 'exercise_Px9ddpLo'
    expect(workoutIdentity({ id: `${stem}.json`, name: `${stem}.json` })).toBe('polar-exercise-Px9ddpLo')
    expect(workoutIdentity({ id: `${stem}.fit`, name: `${stem}.fit` })).toBe('polar-exercise-Px9ddpLo')
    expect(workoutIdentity({ id: `${stem}.gpx`, name: `${stem}.gpx` })).toBe('polar-exercise-Px9ddpLo')
  })

  it('builds an activity fingerprint from date, duration, distance and sport', () => {
    const identity = workoutIdentity({
      id: 'any',
      name: 'Morning Run',
      date: '2026-08-10T10:00:00.000Z',
      durationSeconds: 2730,
      distanceKm: 7.2,
      sport: 'RUNNING',
    })
    expect(identity).toMatch(/^activity-run-/)
    expect(identity).toContain('-46-')
    expect(identity).toContain('-7.2')
  })

  it('falls back to workout.id when no fingerprint or Polar stem exists', () => {
    expect(workoutIdentity({ id: 'custom-id', name: 'Untitled' })).toBe('custom-id')
  })
})

describe('mergeWorkouts', () => {
  it('keeps the richer track and fills missing metadata while preserving id', () => {
    const previous = workout({
      id: 'polar-exercise-Px9ddpLo',
      name: 'exercise_Px9ddpLo.json',
      distanceKm: undefined,
      averageHeartRate: 140,
      records: [{ elapsedSeconds: 0, heartRateBpm: 140 }],
    })
    const next = workout({
      id: 'fit-hash',
      name: 'exercise_Px9ddpLo.fit',
      source: 'fit',
      distanceKm: 5.2,
      averageHeartRate: undefined,
      calories: 420,
      records: [
        { elapsedSeconds: 0, heartRateBpm: 138 },
        { elapsedSeconds: 30, heartRateBpm: 142 },
      ],
    })
    const merged = mergeWorkouts(previous, next)
    expect(merged.id).toBe('polar-exercise-Px9ddpLo')
    expect(merged.records).toHaveLength(2)
    expect(merged.distanceKm).toBe(5.2)
    expect(merged.averageHeartRate).toBe(140)
    expect(merged.calories).toBe(420)
    expect(merged.source).toBe('fit')
  })
})
