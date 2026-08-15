import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { workoutDb } from '../db/database'
import { useSettingsStore } from './settings'
import { useWorkoutStore } from './workouts'
import { usePlanStore } from './plan'
import { useAnalysisStore } from './analysis'
import { useUiStore } from './ui'
import type { Workout } from '../types/workout'

vi.mock('../services/aiService', () => ({
  requestTrainingPlan: vi.fn(async () => ({
    plan: {
      start_date: '2026-08-10',
      week_summary: { focus_title: 'Test', goal_description: 'Demo' },
      days: [
        {
          date: '2026-08-10',
          day: 'monday',
          sport: 'running',
          session_type: 'training',
          title: 'Easy',
          description: 'Easy',
          target_focus: 'Base',
          total_duration_minutes: 40,
          workout_steps: [],
        },
      ],
    },
    debug: true,
  })),
}))

const workout: Workout = {
  id: 'store-1',
  source: 'unknown',
  name: 'Run',
  sport: 'Running',
  date: '2026-08-10',
  durationSeconds: 1800,
  distanceKm: 5,
  averageHeartRate: 140,
  records: [{ elapsedSeconds: 0, heartRateBpm: 140, latitude: 1, longitude: 2 }],
  importedAt: new Date().toISOString(),
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await workoutDb.clearAllUserData()
  vi.stubGlobal('confirm', () => true)
})

describe('settings store', () => {
  it('persists athlete config changes', async () => {
    const settings = useSettingsStore()
    settings.config.thresholds.lthr = 155
    await settings.saveConfig()
    expect(await workoutDb.getConfig()).toMatchObject({ thresholds: { lthr: 155 } })
  })
})

describe('workout store summaries', () => {
  it('exposes list summaries without GPS records', async () => {
    const workouts = useWorkoutStore()
    await workouts.putMany([workout])
    expect(workouts.workouts[0].records).toHaveLength(1)
    expect(workouts.summaries[0].records).toEqual([])
  })
})

describe('import → analysis → plan flow', () => {
  it('loads workouts, computes analysis and persists an AI plan', async () => {
    const workouts = useWorkoutStore()
    const plan = usePlanStore()
    const analysis = useAnalysisStore()
    const ui = useUiStore()

    await workouts.putMany([workout])
    await analysis.refreshAnalysis()
    expect(analysis.analysis.totalDistanceKm).toBe(5)
    expect(analysis.analysisResult).not.toBeNull()

    ui.consent = true
    await plan.createPlan()
    expect(plan.plan.days).toHaveLength(1)
    expect((await workoutDb.getPlan())?.plan?.days).toHaveLength(1)
  })
})
