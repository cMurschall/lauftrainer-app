export function isTrainingPlanLocalMode(mode = import.meta.env.VITE_TRAINING_PLAN_MODE): boolean {
  return ['mock', 'local'].includes(String(mode || ''))
}

export function canCreatePlan(input: {
  consent: boolean
  workoutCount: number
  loading: boolean
  credits: number
  localMode: boolean
}): boolean {
  if (input.loading || !input.consent || input.workoutCount < 1) return false
  if (!input.localMode && input.credits < 1) return false
  return true
}

export type ConnectorBannerKind = 'sync' | 'empty' | 'localData'

export function connectorBannerKind(input: {
  hasWorkouts: boolean
  hasActiveConnected: boolean
}): ConnectorBannerKind {
  if (input.hasActiveConnected) return 'sync'
  if (input.hasWorkouts) return 'localData'
  return 'empty'
}

/** Polar→Strava users who sync both connectors risk double-counting workouts. */
export function shouldWarnPolarStravaOverlap(
  connectors: Array<{ id: string; connected: boolean; active: boolean }>,
): boolean {
  const polar = connectors.find((item) => item.id === 'polar')
  const strava = connectors.find((item) => item.id === 'strava')
  return Boolean(polar?.connected && polar.active && strava?.connected && strava.active)
}

export type CreatePlanButtonMode = 'create' | 'replace'

export function createPlanButtonMode(input: { hasPlan: boolean }): CreatePlanButtonMode {
  return input.hasPlan ? 'replace' : 'create'
}
