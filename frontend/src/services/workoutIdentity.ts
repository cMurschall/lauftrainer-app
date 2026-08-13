import type { Workout } from '../types/workout'

/**
 * Polar exports the same exercise in several formats using the same filename
 * stem (for example exercise_Px9ddpLo.json/.fit/.gpx/.tcx).
 */
export function workoutIdentity(workout: Pick<Workout, 'id' | 'name'>): string {
  const text = `${workout.name} ${workout.id}`
  const polarExercise = text.match(/exercise_([A-Za-z0-9]+)(?:\.|-|$)/i)
  if (polarExercise) return `polar-exercise-${polarExercise[1]}`
  return workout.id
}

export function mergeWorkouts(previous: Workout, next: Workout): Workout {
  const richer = next.records.length >= previous.records.length ? next : previous
  return {
    ...previous,
    ...next,
    id: previous.id,
    // Keep the most useful track and fill metadata missing in one export.
    records: richer.records,
    date: previous.date || next.date,
    durationSeconds: next.durationSeconds || previous.durationSeconds,
    distanceKm: next.distanceKm ?? previous.distanceKm,
    averageHeartRate: next.averageHeartRate ?? previous.averageHeartRate,
    calories: next.calories ?? previous.calories,
    ascentM: next.ascentM ?? previous.ascentM,
    sessionRpe: next.sessionRpe ?? previous.sessionRpe,
    importedAt: next.importedAt,
  }
}
