import type { UserConfig } from '../types/workout'

export const defaultUserConfig = (): UserConfig => ({
  name: 'Athlet',
  trainingFocus: 'base_endurance',
  preferredTrainingDays: ['monday', 'wednesday', 'friday'],
  hrZones: { z1: [90, 106], z2: [107, 124], z3: [125, 142], z4: [143, 160], z5: [161, 179] },
  thresholds: { lthr: 160, hr_max: 186 },
  primarySports: ['Running'],
  // Running is the safe default. Other sports must be explicitly enabled by the athlete.
  availableSports: ['Running'],
  trainingGoal: 'base_endurance',
  sportSpecificThresholds: {},
  performanceNotes: '',
  trainingFrequencyPerWeek: 3,
  strengthTraining: false,
  limitations: '',
  personalNotes: '',
  maxWeeklyTrainingMinutes: undefined,
  maxTrainingMinutesPerDay: {
    monday: undefined,
    tuesday: undefined,
    wednesday: undefined,
    thursday: undefined,
    friday: undefined,
    saturday: undefined,
    sunday: undefined,
  },
})

export function normalizeUserConfig(stored: UserConfig, defaults = defaultUserConfig()): UserConfig {
  const storedDailyLimits = stored.maxTrainingMinutesPerDay || {}
  const dailyLimits = Object.fromEntries(
    Object.entries({ ...defaults.maxTrainingMinutesPerDay, ...storedDailyLimits }).map(([day, value]) => [
      day,
      typeof value === 'number' && value > 0 ? value : undefined,
    ]),
  )
  return {
    ...defaults,
    ...stored,
    maxWeeklyTrainingMinutes:
      typeof stored.maxWeeklyTrainingMinutes === 'number' && stored.maxWeeklyTrainingMinutes > 0
        ? stored.maxWeeklyTrainingMinutes
        : undefined,
    maxTrainingMinutesPerDay: dailyLimits,
  }
}
