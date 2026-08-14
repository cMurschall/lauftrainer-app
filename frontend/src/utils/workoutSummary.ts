import type { ActivityRecord, Workout } from '../types/workout'

/** Workout shape used in lists/dashboard — GPS tracks are omitted to keep memory low. */
export type WorkoutSummary = Omit<Workout, 'records'> & { records: [] }

export function toWorkoutSummary(workout: Workout): WorkoutSummary {
  const { records: _records, ...rest } = workout
  return { ...rest, records: [] }
}

/** Keep HR samples for analysis workers; drop lat/lon to shrink postMessage payloads. */
export function stripGpsFromRecords(records: ActivityRecord[]): ActivityRecord[] {
  return records.map(({ latitude: _lat, longitude: _lon, ...rest }) => rest)
}

export function cloneWorkoutsForAnalysis(workouts: Workout[]): Workout[] {
  return workouts.map((workout) => ({
    ...plainWorkout(workout),
    records: stripGpsFromRecords(workout.records || []),
  }))
}

function plainWorkout(workout: Workout): Workout {
  return JSON.parse(JSON.stringify(workout)) as Workout
}
