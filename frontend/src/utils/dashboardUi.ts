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

export type CreatePlanButtonMode = 'create' | 'replace'

export function createPlanButtonMode(input: { hasPlan: boolean }): CreatePlanButtonMode {
  return input.hasPlan ? 'replace' : 'create'
}
