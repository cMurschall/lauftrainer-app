import type { TrainingPlanDay, UserConfig, Workout } from '../types/workout'
import type { AnalysisResult } from '../analysis/analysisEngine'
import type { TrainingGoal } from '../types/settings'
import { API_URL } from './api'
import { ensureWallet, idempotencyKey, walletToken } from './billingService'

function round(value: number | undefined, digits = 1) {
  if (value === undefined || !Number.isFinite(value)) return undefined
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export async function requestTrainingPlan(
  workouts: Workout[],
  config: UserConfig,
  analysis: AnalysisResult | null,
  goals: TrainingGoal[],
  locale: 'de' | 'en',
): Promise<TrainingPlanDay[]> {
  await ensureWallet()
  const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date))
  const latestLoad = analysis?.load.at(-1)
  const response = await fetch(`${API_URL}/training-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Wallet-Token': walletToken(), 'X-Idempotency-Key': idempotencyKey() },
    body: JSON.stringify({
      locale,
      profile: {
        name: config.name,
        training_goal: config.trainingGoal || config.trainingFocus,
        preferred_training_days: config.preferredTrainingDays,
        training_frequency_per_week: config.trainingFrequencyPerWeek,
        primary_sports: config.primarySports,
        available_sports: config.availableSports,
        max_weekly_training_minutes: config.maxWeeklyTrainingMinutes,
        max_training_minutes_per_day: config.maxTrainingMinutesPerDay,
        strength_training: config.strengthTraining,
        performance_notes: config.performanceNotes,
        limitations: config.limitations,
        personal_notes: config.personalNotes,
        thresholds: config.thresholds,
        hr_zones: config.hrZones,
      },
      goals: goals.map((goal) => ({
        type: goal.type,
        title: goal.title,
        date: goal.date,
        sport: goal.sport,
        distance_km: goal.distanceKm,
        target_time: goal.targetTime,
        target_pace: goal.targetPace,
        priority: goal.priority,
        notes: goal.notes,
      })),
      metrics: {
        latest_load: latestLoad
          ? { date: latestLoad.date, ctl: round(latestLoad.ctl), atl: round(latestLoad.atl), tsb: round(latestLoad.tsb), acwr: round(latestLoad.acwr, 2), risk: latestLoad.risk }
          : null,
        weekly: (analysis?.weekly || []).slice(-12).map((week) => ({
          week_start: week.weekStart,
          total_minutes: round(week.totalMinutes),
          running_minutes: round(week.runningMinutes),
          cycling_minutes: round(week.cyclingMinutes),
          running_distance_km: round(week.runningDistanceKm),
          cycling_distance_km: round(week.cyclingDistanceKm),
        })),
        sports: (analysis?.sports || []).map((sport) => ({
          sport: sport.sport,
          workout_count: sport.workoutCount,
          duration_minutes: round(sport.durationMinutes),
          distance_km: round(sport.distanceKm),
          average_heart_rate: round(sport.averageHeartRate, 0),
        })),
        heart_rate_zones: (analysis?.polarization || []).slice(-12).map((week) => ({
          week_start: week.weekStart,
          z1_percent: round(week.z1Pct),
          z2_percent: round(week.z2Pct),
          z3_percent: round(week.z3Pct),
        })),
      },
      recent_workouts: sorted.slice(0, 21).map((workout) => ({
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
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(detail?.detail || `KI-Backend antwortete mit ${response.status}.`)
  }
  const result = (await response.json()) as { plan: TrainingPlanDay[] }
  if (!Array.isArray(result.plan)) throw new Error('Das KI-Ergebnis hat kein gültiges Planformat.')
  return result.plan
}
