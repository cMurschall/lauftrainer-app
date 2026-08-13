import type { Workout } from '../types/workout'

/**
 * Polar exports the same exercise in several formats using the same filename
 * stem (for example exercise_Px9ddpLo.json/.fit/.gpx/.tcx).
 */
export function workoutIdentity(workout: Pick<Workout, 'id' | 'name'> & Partial<Pick<Workout, 'date' | 'durationSeconds' | 'distanceKm' | 'sport'>>): string {
  if (workout.date && typeof workout.durationSeconds === 'number' && workout.durationSeconds > 0) {
    const timestamp = Date.parse(workout.date)
    if (Number.isFinite(timestamp)) {
      const parts = new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(timestamp))
      const local = Object.fromEntries(parts.map((part) => [part.type, part.value]))
      const minute = `${local.year}-${local.month}-${local.day}T${local.hour}:${local.minute}`
      const duration = Math.round(workout.durationSeconds / 60)
      const distance = workout.distanceKm === undefined ? 'na' : workout.distanceKm.toFixed(1)
      const sport = String(workout.sport || '').toLowerCase()
        .replace('running', 'run')
        .replace('jogging', 'run')
      return `activity-${sport}-${minute}-${duration}-${distance}`
    }
  }
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
