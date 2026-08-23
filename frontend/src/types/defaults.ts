import type { UserConfig } from '../types/workout'
import { normalizeAvailableSportsList } from '../utils/trainingSports'

export const defaultUserConfig = (): UserConfig => ({
  trainingFocus: 'base_endurance',
  preferredTrainingDays: ['monday', 'wednesday', 'friday'],
  hrZones: { z1: [90, 106], z2: [107, 124], z3: [125, 142], z4: [143, 160], z5: [161, 179] },
  thresholds: { lthr: 160, hr_max: 186, hr_rest: 55 },
  primarySports: ['Running'],
  // Running is the safe default. Other sports must be explicitly enabled by the athlete.
  availableSports: ['Running'],
  trainingGoal: 'base_endurance',
  sportSpecificThresholds: {},
  performanceNotes: '',
  strengthTraining: false,
  limitations: '',
})

export function normalizeUserConfig(
  stored: Partial<UserConfig> | Record<string, unknown> | undefined,
  defaults = defaultUserConfig(),
): UserConfig {
  const source = (stored || {}) as Partial<UserConfig> & Record<string, unknown>
  const preferredTrainingDays = Array.isArray(source.preferredTrainingDays)
    ? source.preferredTrainingDays.map(String).filter(Boolean)
    : defaults.preferredTrainingDays
  const availableSports = normalizeAvailableSportsList(
    Array.isArray(source.availableSports) ? source.availableSports.map(String) : defaults.availableSports || [],
  )

  return {
    trainingFocus:
      typeof source.trainingFocus === 'string' && source.trainingFocus ? source.trainingFocus : defaults.trainingFocus,
    preferredTrainingDays: preferredTrainingDays.length ? preferredTrainingDays : [...defaults.preferredTrainingDays],
    hrZones: { ...defaults.hrZones, ...(source.hrZones || {}) },
    thresholds: { ...defaults.thresholds, ...(source.thresholds || {}) },
    primarySports:
      Array.isArray(source.primarySports) && source.primarySports.length
        ? source.primarySports
        : defaults.primarySports,
    availableSports: availableSports.length ? availableSports : [...(defaults.availableSports || ['Running'])],
    trainingGoal:
      typeof source.trainingGoal === 'string' && source.trainingGoal
        ? source.trainingGoal
        : typeof source.trainingFocus === 'string' && source.trainingFocus
          ? source.trainingFocus
          : defaults.trainingGoal,
    sportSpecificThresholds: source.sportSpecificThresholds || defaults.sportSpecificThresholds,
    performanceNotes: typeof source.performanceNotes === 'string' ? source.performanceNotes : defaults.performanceNotes,
    strengthTraining: Boolean(source.strengthTraining),
    limitations: typeof source.limitations === 'string' ? source.limitations : defaults.limitations,
  }
}
