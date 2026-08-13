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

export interface Workout {
  id: string
  source: 'polar-csv' | 'polar-json' | 'tcx' | 'gpx' | 'fit' | 'unknown'
  name: string
  sport: string
  date: string
  durationSeconds: number
  distanceKm?: number
  averageHeartRate?: number
  calories?: number
  records: ActivityRecord[]
  importedAt: string
  sourceFileHash?: string
  ascentM?: number
  averagePaceSecondsPerKm?: number
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
}

export interface AnalysisSummary {
  totalDistanceKm: number
  totalDurationMinutes: number
  weekly: WeeklyAnalysis[]
  zoneMinutes: Record<string, number>
}

export interface UserConfig {
  name: string
  trainingFocus: string
  preferredTrainingDays: string[]
  hrZones: Record<string, [number, number]>
  thresholds: Record<string, number>
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
