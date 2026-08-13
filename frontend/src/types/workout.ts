export interface ActivityRecord {
  elapsedSeconds: number
  heartRateBpm?: number
  speedKmh?: number
  altitudeM?: number
  powerW?: number
  distanceM?: number
  latitude?: number
  longitude?: number
}
export const SPORT_CATEGORIES = ['Running', 'Cycling', 'Swimming', 'Hiking', 'Walking', 'Triathlon', 'Other'] as const
export type SportCategory = (typeof SPORT_CATEGORIES)[number]
export type MultisportDiscipline = 'Swimming' | 'Cycling' | 'Running'

export interface Workout {
  id: string
  source: 'polar-csv' | 'polar-json' | 'strava' | 'tcx' | 'gpx' | 'fit' | 'unknown'
  name: string
  sport: string
  rawSport?: string
  date: string
  durationSeconds: number
  distanceKm?: number
  averageHeartRate?: number
  calories?: number
  records: ActivityRecord[]
  importedAt: string
  sourceFileHash?: string
  ascentM?: number
  elevationGainM?: number
  averageSpeedKmh?: number
  maxSpeedKmh?: number
  averagePowerW?: number
  maxPowerW?: number
  normalizedPowerW?: number
  averagePaceSecondsPerKm?: number
  swimmingDistanceM?: number
  swimmingLaps?: number
  swimmingStrokes?: number
  poolLengthM?: number
  verticalSpeedMPerHour?: number
  multisportGroupId?: string
  multisportDiscipline?: MultisportDiscipline
  multisportOrder?: 1 | 2 | 3
  /** Optional perceived exertion score, deliberately not populated by imports. */
  sessionRpe?: number
}

export interface WeeklyAnalysis {
  weekStart: string
  workoutCount: number
  distanceKm: number
  durationMinutes: number
  trainingLoad: number
  averageHeartRate?: number
  calories?: number
  elevationGainM?: number
  sports: Partial<Record<SportCategory, { workoutCount: number; durationMinutes: number; distanceKm: number; trainingLoad: number }>>
}

export interface AnalysisSummary {
  totalDistanceKm: number
  totalDurationMinutes: number
  weekly: WeeklyAnalysis[]
  zoneMinutes: Record<string, number>
  totalCalories?: number
  totalElevationGainM?: number
}

export interface UserConfig {
  name: string
  trainingFocus: string
  preferredTrainingDays: string[]
  hrZones: Record<string, [number, number]>
  thresholds: Record<string, number>
  primarySports?: SportCategory[]
  availableSports?: SportCategory[]
  trainingGoal?: string
  sportSpecificThresholds?: Partial<Record<SportCategory, Record<string, number>>>
  performanceNotes?: string
  trainingFrequencyPerWeek?: number
  strengthTraining?: boolean
  limitations?: string
  personalNotes?: string
  maxWeeklyTrainingMinutes?: number
  maxTrainingMinutesPerDay?: Record<string, number | undefined>
}

export interface TrainingPlanStep {
  step_duration: string
  step_intensity: string
  step_instruction: string
}

export interface TrainingPlanDay {
  day: string
  sport: string
  description: string
  target_focus: string
  total_duration_minutes: number
  workout_steps: TrainingPlanStep[]
}
