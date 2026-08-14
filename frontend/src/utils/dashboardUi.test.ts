import { describe, expect, it } from 'vitest'
import { canCreatePlan, connectorBannerKind, createPlanButtonMode, isTrainingPlanLocalMode } from './dashboardUi'

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

  it('switches create vs replace button mode', () => {
    expect(createPlanButtonMode({ hasPlan: false })).toBe('create')
    expect(createPlanButtonMode({ hasPlan: true })).toBe('replace')
  })
})
