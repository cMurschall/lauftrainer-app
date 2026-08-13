import { beforeEach, describe, expect, it } from 'vitest'
import { exportBackup, importBackup, workoutDb } from './database'
import type { Workout } from '../types/workout'

const sample: Workout = {
  id: 'db-1',
  source: 'unknown',
  name: 'Testlauf',
  sport: 'Running',
  date: '2026-08-10',
  durationSeconds: 1800,
  distanceKm: 5,
  records: [],
  importedAt: new Date().toISOString(),
}

beforeEach(async () => {
  await workoutDb.deleteAll()
  await workoutDb.clearAnalysisCache()
})

describe('local database and backups', () => {
  it('increments workout revision and clears analysis cache on writes', async () => {
    const first = await workoutDb.getWorkoutRevision()
    await workoutDb.saveAnalysisCache({
      id: 'analysis',
      cacheKey: 'old',
      createdAt: '',
      dashboardSummary: {} as never,
      analysisResult: {} as never,
    })
    await workoutDb.put(sample)
    expect(await workoutDb.getWorkoutRevision()).toBe(first + 1)
    expect(await workoutDb.getAnalysisCache('old')).toBeUndefined()
  })

  it('exports and restores workouts, while rejecting malformed backups', async () => {
    await workoutDb.put(sample)
    const backup = await exportBackup()
    await workoutDb.deleteAll()
    await importBackup(backup)
    expect((await workoutDb.list()).map((item) => item.id)).toEqual(['db-1'])
    await expect(importBackup({ version: 2, workouts: [] } as never)).rejects.toThrow(/Backup/)
  })

  it('does not bump analysis revision for app-only settings', async () => {
    const before = await workoutDb.getWorkoutRevision()
    await workoutDb.saveAppSettings({ theme: 'dark', locale: 'de', connectors: [] })
    expect(await workoutDb.getWorkoutRevision()).toBe(before)
  })
})
