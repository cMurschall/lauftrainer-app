import type { TrainingPlanDay, UserConfig, Workout } from '../types/workout'
import { API_URL } from './api'

export async function requestTrainingPlan(workouts: Workout[], config: UserConfig): Promise<TrainingPlanDay[]> {
  const response = await fetch(`${API_URL}/training-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config,
      workouts: workouts.slice(0, 14).map((workout) => ({
        date: workout.date,
        sport: workout.sport,
        duration_minutes: Math.round(workout.durationSeconds / 60),
        distance_km: workout.distanceKm,
        avg_hr: workout.averageHeartRate,
        calories: workout.calories,
        elevation_gain_m: workout.elevationGainM ?? workout.ascentM,
        average_power_w: workout.averagePowerW,
        average_speed_kmh: workout.averageSpeedKmh,
      })),
    }),
  })
  if (!response.ok) throw new Error(`KI-Backend antwortete mit ${response.status}.`)
  const result = (await response.json()) as { plan: TrainingPlanDay[] }
  if (!Array.isArray(result.plan)) throw new Error('Das KI-Ergebnis hat kein gültiges Planformat.')
  return result.plan
}
