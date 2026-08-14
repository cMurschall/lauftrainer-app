import { beforeEach, describe, expect, it } from 'vitest'
import { calculateAnalysis as calculateDashboardAnalysis } from '../analysis/localAnalysis'
import { isoWeekStart } from '../analysis/analysisEngine'
import { exportBackup, importBackup, workoutDb } from './database'
import type { TrainingPlan, TrainingPlanDay, UserConfig, Workout } from '../types/workout'

const sample: Workout = {
  id: 'db-1',
  source: 'unknown',
  name: 'Testlauf',
  sport: 'Running',
  date: '2026-08-10',
  durationSeconds: 1800,
  distanceKm: 5,
  records: [{ elapsedSeconds: 0, latitude: 52.5, longitude: 13.4, heartRateBpm: 140 }],
  importedAt: new Date().toISOString(),
}

const config: UserConfig = {
  name: 'Athlet',
  trainingFocus: 'base_endurance',
  preferredTrainingDays: ['monday'],
  hrZones: { z1: [90, 106], z2: [107, 124], z3: [125, 142], z4: [143, 160], z5: [161, 179] },
  thresholds: { lthr: 160, hr_max: 186 },
}

const samplePlan: TrainingPlan = {
  week_summary: { focus_title: 'Basis', goal_description: 'Locker aufbauen.' },
  days: [
    {
      day: 'monday',
      sport: 'running',
      session_type: 'training',
      title: 'Lockerer Lauf',
      description: 'Lockerer Lauf',
      target_focus: 'Grundlagenausdauer',
      total_duration_minutes: 30,
      workout_steps: [],
    } satisfies TrainingPlanDay,
  ],
}

beforeEach(async () => {
  await workoutDb.clearAllUserData()
  await workoutDb.clearAnalysisCache()
})

describe('local database and backups', () => {
  it('persists the current training plan across reads', async () => {
    await workoutDb.savePlan(samplePlan)
    expect(await workoutDb.getPlan()).toMatchObject({ plan: samplePlan })
  })

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

  it('exports and restores workouts, plan, config and goals atomically', async () => {
    await workoutDb.put(sample)
    await workoutDb.saveConfig(config)
    await workoutDb.savePlan(samplePlan)
    await workoutDb.savePlanWithStatus(samplePlan, ['monday'])
    await workoutDb.saveGoal({
      id: 'goal-1',
      type: 'race',
      title: '10K',
      date: '2026-09-01',
      createdAt: new Date().toISOString(),
    })
    await workoutDb.saveAppSettings({ theme: 'dark', locale: 'de', connectors: [] })

    const backup = await exportBackup()
    expect(backup.currentPlan?.plan?.days).toHaveLength(1)
    expect(backup.currentPlan?.completedDays).toEqual(['monday'])
    expect(backup.goals).toHaveLength(1)

    await workoutDb.clearAllUserData()
    expect(await workoutDb.list()).toEqual([])
    expect(await workoutDb.getPlan()).toBeUndefined()
    expect(await workoutDb.getConfig()).toBeUndefined()

    await importBackup(backup)
    expect((await workoutDb.list()).map((item) => item.id)).toEqual(['db-1'])
    expect(await workoutDb.getConfig()).toMatchObject({ name: 'Athlet' })
    expect(await workoutDb.getPlan()).toMatchObject({
      plan: samplePlan,
      completedDays: ['monday'],
    })
    expect(await workoutDb.listGoals()).toHaveLength(1)
    expect(await workoutDb.getAppSettings()).toMatchObject({ theme: 'dark' })
    await expect(importBackup({ version: 2, workouts: [] } as never)).rejects.toThrow(/Backup/)
  })

  it('clears plan and config with clearAllUserData while keeping app settings', async () => {
    await workoutDb.put(sample)
    await workoutDb.saveConfig(config)
    await workoutDb.savePlan(samplePlan)
    await workoutDb.saveAppSettings({ theme: 'light', locale: 'en', connectors: [] })
    await workoutDb.clearAllUserData()
    expect(await workoutDb.list()).toEqual([])
    expect(await workoutDb.getConfig()).toBeUndefined()
    expect(await workoutDb.getPlan()).toBeUndefined()
    expect(await workoutDb.getAppSettings()).toMatchObject({ theme: 'light', locale: 'en' })
  })

  it('batches putMany with a single revision bump', async () => {
    const before = await workoutDb.getWorkoutRevision()
    await workoutDb.putMany([
      sample,
      { ...sample, id: 'db-2', name: 'Zweiter Lauf' },
    ])
    expect(await workoutDb.getWorkoutRevision()).toBe(before + 1)
    expect(await workoutDb.list()).toHaveLength(2)
  })

  it('listSummaries strips GPS tracks', async () => {
    await workoutDb.put(sample)
    const summaries = await workoutDb.listSummaries()
    expect(summaries[0].records).toEqual([])
    expect((await workoutDb.list())[0].records).toHaveLength(1)
  })

  it('preserves plan createdAt when toggling completion status', async () => {
    await workoutDb.savePlan(samplePlan)
    const first = await workoutDb.getPlan()
    await new Promise((resolve) => setTimeout(resolve, 5))
    await workoutDb.savePlanWithStatus(samplePlan, ['monday'])
    const second = await workoutDb.getPlan()
    expect(second?.createdAt).toBe(first?.createdAt)
    expect(second?.completedDays).toEqual(['monday'])
  })

  it('does not bump analysis revision for app-only settings', async () => {
    const before = await workoutDb.getWorkoutRevision()
    await workoutDb.saveAppSettings({ theme: 'dark', locale: 'de', connectors: [] })
    expect(await workoutDb.getWorkoutRevision()).toBe(before)
  })
})

describe('shared ISO week boundaries', () => {
  it('uses the same Monday start for dashboard and analysis helpers', () => {
    expect(isoWeekStart('05-01-2025')).toBe('2024-12-30')
    const summary = calculateDashboardAnalysis(
      [
        {
          ...sample,
          id: 'w1',
          date: '05-01-2025',
          records: [],
        },
      ],
      config,
    )
    expect(summary.weekly[0]?.weekStart).toBe('2024-12-30')
  })
})
