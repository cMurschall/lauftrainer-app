import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestTrainingPlan } from './aiService'
import type { UserConfig, Workout } from '../types/workout'

vi.mock('./billingService', () => ({
  ensureWallet: vi.fn(async () => undefined),
  idempotencyKey: () => 'idem',
  walletToken: () => 'wallet',
}))

const config: UserConfig = {
  name: 'Ada',
  trainingFocus: 'base_endurance',
  preferredTrainingDays: ['monday'],
  hrZones: { z1: [90, 106] },
  thresholds: { lthr: 160, hr_max: 186 },
  maxWeeklyTrainingMinutes: 0,
}

const workout: Workout = {
  id: 'w1',
  source: 'unknown',
  name: 'Run',
  sport: 'Running',
  date: '2026-08-10',
  durationSeconds: 1800,
  distanceKm: 5,
  records: [],
  importedAt: '',
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const call = fetchMock.mock.calls[index] as unknown as [string, RequestInit]
  return JSON.parse(String(call[1]?.body))
}

describe('requestTrainingPlan payload', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('omits non-positive max_weekly_training_minutes', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        plan: {
          week_summary: { focus_title: 'Base', goal_description: 'Build' },
          days: [],
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await requestTrainingPlan([workout], config, null, [], 'en')
    expect(requestBody(fetchMock, 0).profile.max_weekly_training_minutes).toBeUndefined()

    await requestTrainingPlan(
      [workout],
      { ...config, maxWeeklyTrainingMinutes: undefined },
      null,
      [],
      'en',
    )
    expect(requestBody(fetchMock, 1).profile.max_weekly_training_minutes).toBeUndefined()

    await requestTrainingPlan(
      [workout],
      { ...config, maxWeeklyTrainingMinutes: 300 },
      null,
      [],
      'en',
    )
    expect(requestBody(fetchMock, 2).profile.max_weekly_training_minutes).toBe(300)
  })

  it('sends rolling start date, coach style and previous plan', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        plan: {
          start_date: '2026-08-14',
          week_summary: { focus_title: 'Base', goal_description: 'Build' },
          days: [],
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await requestTrainingPlan([workout], config, null, [], 'de', {
      planStartDate: '2026-08-14',
      coachStyle: 'mentor',
      previousPlan: {
        start_date: '2026-08-07',
        week_summary: { focus_title: 'Alt', goal_description: 'Vorher' },
        days: [
          {
            date: '2026-08-07',
            day: 'friday',
            sport: 'running',
            session_type: 'training',
            title: 'Easy',
            total_duration_minutes: 30,
            completed: true,
          },
        ],
      },
    })

    const body = requestBody(fetchMock, 0)
    expect(body.plan_start_date).toBe('2026-08-14')
    expect(body.coach_style).toBe('mentor')
    expect(body.previous_plan.days[0]).toMatchObject({ date: '2026-08-07', completed: true })
  })
})
