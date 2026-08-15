import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestTrainingPlan } from './aiService'
import type { UserConfig, Workout } from '../types/workout'

vi.mock('./billingService', () => ({
  ensureWallet: vi.fn(async () => undefined),
  idempotencyKey: () => 'idem',
  walletToken: () => 'wallet',
}))

const config: UserConfig = {
  trainingFocus: 'base_endurance',
  preferredTrainingDays: ['monday', 'wednesday', 'friday'],
  hrZones: { z1: [90, 106] },
  thresholds: { lthr: 160, hr_max: 186 },
  availableSports: ['Running', 'Ski'],
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

  it('derives frequency from preferred days and keeps custom sports', async () => {
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
    const body = requestBody(fetchMock, 0)
    expect(body.profile.training_frequency_per_week).toBe(3)
    expect(body.profile.available_sports).toEqual(['running', 'Ski'])
    expect(body.profile.max_weekly_training_minutes).toBeUndefined()
    expect(body.profile.max_training_minutes_per_day).toBeUndefined()
    expect(body.profile.name).toBeUndefined()
    expect(body.profile.personal_notes).toBeUndefined()
  })

  it('sends rolling start date, coach style, previous plan and plan notes', async () => {
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
      planNotes: 'Diese Woche viel Reisen',
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
    expect(body.profile.plan_notes).toBe('Diese Woche viel Reisen')
  })
})
