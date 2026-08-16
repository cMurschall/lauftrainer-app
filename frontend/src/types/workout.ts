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
/** OSM background layers for a route preview, each path as [lon, lat] pairs. */
export interface MapContext {
  waterways: [number, number][][]
  highways: [number, number][][]
  coastlines: [number, number][][]
  residential: [number, number][][]
  forests: [number, number][][]
}
export const SPORT_CATEGORIES = ['Running', 'Cycling', 'Swimming', 'Hiking', 'Walking', 'Climbing', 'Triathlon', 'Other'] as const
export type SportCategory = (typeof SPORT_CATEGORIES)[number]
export const TRAINING_SPORT_CATEGORIES = ['Cycling', 'Running', 'Hiking', 'Swimming', 'Cardio', 'Strength', 'Mobility'] as const
export type TrainingSportCategory = (typeof TRAINING_SPORT_CATEGORIES)[number]
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
  trainingFocus: string
  preferredTrainingDays: string[]
  hrZones: Record<string, [number, number]>
  thresholds: Record<string, number>
  primarySports?: SportCategory[]
  /** Known training sports and optional free-text sports for AI planning. */
  availableSports?: string[]
  trainingGoal?: string
  sportSpecificThresholds?: Partial<Record<SportCategory, Record<string, number>>>
  performanceNotes?: string
  strengthTraining?: boolean
  limitations?: string
}

export interface TrainingPlanStep {
  step_duration: string
  step_intensity: string
  step_instruction: string
}

export type WeekDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
export type TrainingPlanSport = 'running' | 'cycling' | 'swimming' | 'hiking' | 'cardio' | 'rowing' | 'strength' | 'mobility' | 'other'
export type TrainingSessionType = 'training' | 'rest'
export type CoachStyle = 'mentor' | 'pragmatist' | 'performance'

export interface TrainingPlanDay {
  /** ISO calendar date YYYY-MM-DD for this plan day (rolling 7-day window). */
  date: string
  day: WeekDay
  sport: TrainingPlanSport
  /** Display name for custom sports when `sport` is `other`. */
  sport_label?: string
  session_type: TrainingSessionType
  title: string
  description: string
  target_focus: string
  total_duration_minutes: number
  workout_steps: TrainingPlanStep[]
}

export interface TrainingWeekSummary {
  focus_title: string
  goal_description: string
}

export interface TrainingPlanHistoryEntry {
  id: string
  createdAt: string
  plan: TrainingPlan
  completedDates?: string[]
  /** @deprecated legacy weekday keys; ignored when plan days have dates */
  completedDays?: string[]
}

export interface TrainingPlan {
  /** First day of the rolling window (YYYY-MM-DD). */
  start_date?: string
  week_summary: TrainingWeekSummary
  days: TrainingPlanDay[]
}
