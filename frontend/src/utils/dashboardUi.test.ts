import { describe, expect, it } from 'vitest'
import {
  averageWeeklyMinutes,
  canCreatePlan,
  connectorBannerKind,
  createPlanButtonMode,
  isTrainingPlanLocalMode,
  shouldWarnPolarStravaOverlap,
  sportKind,
  weeklyTrend,
} from './dashboardUi'

const week = (weekStart: string, durationMinutes: number, workoutCount = 1, distanceKm = 0) => ({
  weekStart,
  durationMinutes,
  workoutCount,
  distanceKm,
})

describe('dashboardUi helpers', () => {
  it('detects local training plan modes', () => {
    expect(isTrainingPlanLocalMode('local')).toBe(true)
    expect(isTrainingPlanLocalMode('mock')).toBe(true)
    expect(isTrainingPlanLocalMode('production')).toBe(false)
  })

  it('gates create plan on consent, workouts, loading and credits', () => {
    expect(
      canCreatePlan({ consent: true, workoutCount: 2, loading: false, credits: 0, localMode: true }),
    ).toBe(true)
    expect(
      canCreatePlan({ consent: false, workoutCount: 2, loading: false, credits: 5, localMode: false }),
    ).toBe(false)
    expect(
      canCreatePlan({ consent: true, workoutCount: 0, loading: false, credits: 5, localMode: false }),
    ).toBe(false)
    expect(
      canCreatePlan({ consent: true, workoutCount: 2, loading: true, credits: 5, localMode: false }),
    ).toBe(false)
    expect(
      canCreatePlan({ consent: true, workoutCount: 2, loading: false, credits: 0, localMode: false }),
    ).toBe(false)
    expect(
      canCreatePlan({ consent: true, workoutCount: 2, loading: false, credits: 1, localMode: false }),
    ).toBe(true)
  })

  it('classifies connector banners', () => {
    expect(connectorBannerKind({ hasWorkouts: false, hasActiveConnected: false })).toBe('empty')
    expect(connectorBannerKind({ hasWorkouts: true, hasActiveConnected: false })).toBe('localData')
    expect(connectorBannerKind({ hasWorkouts: true, hasActiveConnected: true })).toBe('sync')
  })

  it('warns when Polar and Strava are both connected and active', () => {
    expect(
      shouldWarnPolarStravaOverlap([
        { id: 'polar', connected: true, active: true },
        { id: 'strava', connected: true, active: true },
      ]),
    ).toBe(true)
    expect(
      shouldWarnPolarStravaOverlap([
        { id: 'polar', connected: true, active: true },
        { id: 'strava', connected: true, active: false },
      ]),
    ).toBe(false)
    expect(
      shouldWarnPolarStravaOverlap([
        { id: 'polar', connected: true, active: true },
        { id: 'strava', connected: false, active: true },
      ]),
    ).toBe(false)
  })

  it('switches create vs replace button mode', () => {
    expect(createPlanButtonMode({ hasPlan: false })).toBe('create')
    expect(createPlanButtonMode({ hasPlan: true })).toBe('replace')
  })

  it('maps sport names onto accent kinds', () => {
    expect(sportKind('Running')).toBe('running')
    expect(sportKind('laufen')).toBe('running')
    expect(sportKind('Radfahren')).toBe('cycling')
    expect(sportKind('Open water swim')).toBe('swimming')
    expect(sportKind('Wandern')).toBe('hiking')
    expect(sportKind('Walking')).toBe('walking')
    expect(sportKind('Strength')).toBe('other')
    expect(sportKind(undefined)).toBe('other')
  })

  it('scales weekly trend bars against the highest training time, newest first', () => {
    const trend = weeklyTrend({
      weekly: [week('2026-07-27', 60), week('2026-08-03', 120), week('2026-08-10', 30)],
      currentWeekStart: '2026-08-10',
      limit: 6,
    })
    expect(trend.map((entry) => entry.weekStart)).toEqual(['2026-08-10', '2026-08-03', '2026-07-27'])
    expect(trend.map((entry) => entry.sharePercent)).toEqual([25, 100, 50])
    expect(trend[0].isCurrentWeek).toBe(true)
  })

  it('limits the trend range and keeps an untrained current week visible', () => {
    const trend = weeklyTrend({
      weekly: [week('2026-06-29', 10), week('2026-07-06', 20), week('2026-07-13', 30)],
      currentWeekStart: '2026-08-10',
      limit: 2,
    })
    expect(trend.map((entry) => entry.weekStart)).toEqual(['2026-08-10', '2026-07-13'])
    expect(trend[0]).toMatchObject({ durationMinutes: 0, workoutCount: 0, sharePercent: 0, isCurrentWeek: true })
  })

  it('averages completed weeks only and ignores the in-progress week', () => {
    expect(
      averageWeeklyMinutes({
        weekly: [week('2026-07-20', 20), week('2026-07-27', 40), week('2026-08-10', 5)],
        currentWeekStart: '2026-08-10',
        weeks: 4,
      }),
    ).toBe(30)
    expect(averageWeeklyMinutes({ weekly: [week('2026-08-10', 5)], currentWeekStart: '2026-08-10' })).toBe(0)
  })
})
