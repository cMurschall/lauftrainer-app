import { beforeEach, describe, expect, it } from 'vitest'
import { workoutDb } from '../db/database'
import { importWorkoutFile, importWorkoutFiles } from './importService'

function textFile(name: string, contents: string, type = 'text/plain') {
  return new File([contents], name, { type })
}

const polarJson = (id: string) =>
  JSON.stringify({
    id,
    start_time: '2025-12-06T11:26:58Z',
    duration: 'PT1800S',
    distance: 5000,
    sport: 'RUNNING',
    heart_rate: { average: 137 },
  })

const gpx = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="50" lon="10"><ele>100</ele><time>2026-08-10T10:00:00Z</time></trkpt><trkpt lat="50.001" lon="10"><ele>110</ele><time>2026-08-10T10:01:00Z</time></trkpt></trkseg></trk></gpx>`

const tcx = `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Id>2026-08-10T10:00:00Z</Id><Lap><TotalTimeSeconds>120</TotalTimeSeconds><DistanceMeters>1000</DistanceMeters><Track><Trackpoint><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>`

const csv =
  'Name,Sport,Date,Duration,Total distance (km),Average heart rate (bpm),Calories\nMorning Run,RUNNING,11-08-2026,00:45:30,"7,20",142,500'

beforeEach(async () => {
  await workoutDb.clearAllUserData()
  await workoutDb.clearAnalysisCache()
})

describe('importService', () => {
  it('routes CSV, JSON, TCX and GPX by extension', async () => {
    const csvWorkout = await importWorkoutFile(textFile('run.csv', csv))
    expect(csvWorkout.distanceKm).toBe(7.2)

    const jsonWorkout = await importWorkoutFile(textFile('exercise_abc123.json', polarJson('a')))
    expect(jsonWorkout.durationSeconds).toBe(1800)
    expect(jsonWorkout.id).toBe('polar-exercise-abc123')

    const tcxWorkout = await importWorkoutFile(textFile('run.tcx', tcx))
    expect(tcxWorkout.distanceKm).toBe(1)

    const gpxWorkout = await importWorkoutFile(textFile('route.gpx', gpx))
    expect(gpxWorkout.durationSeconds).toBe(60)
  })

  it('rejects unsupported extensions', async () => {
    await expect(importWorkoutFile(textFile('notes.txt', 'hello'))).rejects.toThrow(/noch nicht unterstützt/)
  })

  it('dedups Polar multi-format batch imports into one winner', async () => {
    const first = await importWorkoutFile(textFile('exercise_Px9ddpLo.json', polarJson('json')))
    expect(first.id).toBe('polar-exercise-Px9ddpLo')

    const result = await importWorkoutFiles([
      textFile('exercise_Px9ddpLo.json', polarJson('again')),
      textFile('exercise_Px9ddpLo.gpx', gpx),
    ])
    expect(result.imported).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.workouts).toHaveLength(1)
    expect(result.workouts[0].id).toBe('polar-exercise-Px9ddpLo')

    const stored = await workoutDb.list()
    expect(stored.filter((item) => item.id === 'polar-exercise-Px9ddpLo')).toHaveLength(1)
  })

  it('re-imports merge into IndexedDB with a stable polar identity', async () => {
    const first = await importWorkoutFile(textFile('exercise_MergeMe.json', polarJson('m1')))
    expect(first.averageHeartRate).toBe(137)

    const updated = await importWorkoutFile(
      textFile(
        'exercise_MergeMe.json',
        JSON.stringify({
          id: 'm2',
          start_time: '2025-12-06T11:26:58Z',
          duration: 'PT1800S',
          distance: 5200,
          sport: 'RUNNING',
          heart_rate: { average: 141 },
        }),
      ),
    )
    expect(updated.id).toBe('polar-exercise-MergeMe')
    expect(updated.distanceKm).toBeCloseTo(5.2)
    expect(updated.averageHeartRate).toBe(141)

    const stored = await workoutDb.list()
    expect(stored.filter((item) => item.id === 'polar-exercise-MergeMe')).toHaveLength(1)
  })
})
