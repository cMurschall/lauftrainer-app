import { describe, expect, it } from 'vitest'
import { parsePolarJson, recordsFromPolarRoute } from './json'

describe('parsePolarJson', () => {
  it('liest Polar ISO-8601-Dauern als Sekunden', () => {
    const workout = parsePolarJson(
      JSON.stringify({
        id: 'run-1',
        start_time: '2025-12-06T11:26:58Z',
        duration: 'PT3428.529S',
        distance: 6489,
        sport: 'RUNNING',
        heart_rate: { average: 137 },
      }),
      'exercise.json',
    )
    expect(workout.durationSeconds).toBeCloseTo(3428.529)
    expect(workout.distanceKm).toBeCloseTo(6.489)
    expect(workout.averageHeartRate).toBe(137)
    expect(workout.records).toEqual([])
  })

  it('übernimmt GPS-Punkte aus route[]', () => {
    const workout = parsePolarJson(
      JSON.stringify({
        id: 'run-2',
        start_time: '2025-12-06T11:26:58Z',
        duration: 'PT100S',
        distance: 1000,
        sport: 'RUNNING',
        route: [
          { latitude: 54.3, longitude: 10.1, time: 'PT0S' },
          { latitude: 54.31, longitude: 10.12, time: 'PT50S' },
          { latitude: 54.32, longitude: 10.14, time: 'PT100S' },
        ],
      }),
      'exercise_route.json',
    )
    expect(workout.records).toHaveLength(3)
    expect(workout.records[0]).toMatchObject({ latitude: 54.3, longitude: 10.1, elapsedSeconds: 0 })
    expect(workout.records[2]).toMatchObject({ latitude: 54.32, longitude: 10.14, elapsedSeconds: 100 })
  })
})

describe('recordsFromPolarRoute', () => {
  it('supports parallel latitude/longitude arrays', () => {
    const records = recordsFromPolarRoute(
      {
        route: {
          latitude: [54.3, 54.31, 54.32],
          longitude: [10.1, 10.12, 10.14],
        },
      },
      90,
    )
    expect(records).toHaveLength(3)
    expect(records[1]).toMatchObject({ latitude: 54.31, longitude: 10.12, elapsedSeconds: 45 })
  })
})
