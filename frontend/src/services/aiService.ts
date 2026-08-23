import type { CoachStyle, TrainingPlan, UserConfig, Workout } from '../types/workout'
import type { AnalysisResult } from '../analysis/analysisEngine'
import type { TrainingGoal } from '../types/settings'
import { API_URL } from './api'
import { ensureWallet, idempotencyKey, walletToken } from './billingService'
import { localDateKey } from '../utils/planDates'
import { toPlanAvailableSports, trainingFrequencyFromPreferredDays } from '../utils/trainingSports'

export interface TrainingPlanResponse {
  plan: TrainingPlan
  debug?: boolean
  detail?: string
}

export interface PreviousPlanPayload {
  start_date?: string
  week_summary?: { focus_title: string; goal_description: string }
  days: Array<{
    date?: string
    day: string
    sport: string
    session_type: string
    title: string
    total_duration_minutes: number
    completed: boolean
  }>
}

export interface TrainingPlanRequestOptions {
  planStartDate?: string
  coachStyle?: CoachStyle
  previousPlan?: PreviousPlanPayload
  /** Ephemeral week notes collected before plan creation. */
  planNotes?: string
}

function planSportKey(value: string): string {
  const normalized = value.toLowerCase()
  const aliases: Record<string, string> = {
    run: 'running',
    running: 'running',
    ride: 'cycling',
    cycling: 'cycling',
    swim: 'swimming',
    swimming: 'swimming',
    hike: 'hiking',
    hiking: 'hiking',
    walk: 'hiking',
    walking: 'hiking',
    cardio: 'cardio',
    ergometer: 'cardio',
    treadmill: 'cardio',
    elliptical: 'cardio',
    crosstrainer: 'cardio',
    spinning: 'cardio',
    row: 'cardio',
    rowing: 'cardio',
    strength: 'strength',
    mobility: 'mobility',
    yoga: 'mobility',
  }
  return aliases[normalized] || 'other'
}

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
  options: TrainingPlanRequestOptions = {},
): Promise<TrainingPlanResponse> {
  const localMode = ['mock', 'local'].includes(import.meta.env.VITE_TRAINING_PLAN_MODE)
  if (!localMode) await ensureWallet()
  const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date))
  const latestLoad = analysis?.load.at(-1)
  const planStartDate = options.planStartDate || localDateKey()
  const coachStyle =
    options.coachStyle === 'mentor' || options.coachStyle === 'performance' ? options.coachStyle : 'pragmatist'
  const planNotes = options.planNotes?.trim() || undefined
  const response = await fetch(`${API_URL}/training-plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wallet-Token': walletToken(),
      'X-Idempotency-Key': idempotencyKey(),
    },
    body: JSON.stringify({
      locale,
      plan_start_date: planStartDate,
      coach_style: coachStyle,
      previous_plan: options.previousPlan,
      profile: {
        training_goal: config.trainingGoal || config.trainingFocus,
        preferred_training_days: config.preferredTrainingDays,
        training_frequency_per_week: trainingFrequencyFromPreferredDays(config.preferredTrainingDays),
        primary_sports: (config.primarySports || []).map(planSportKey),
        available_sports: toPlanAvailableSports(config.availableSports, config.strengthTraining),
        strength_training: config.strengthTraining,
        performance_notes: config.performanceNotes,
        limitations: config.limitations,
        plan_notes: planNotes,
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
          ? {
              date: latestLoad.date,
              ctl: round(latestLoad.ctl),
              atl: round(latestLoad.atl),
              tsb: round(latestLoad.tsb),
              acwr: round(latestLoad.acwr, 2),
              risk: latestLoad.risk,
            }
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
        latest_vo2max_mlkgmin: analysis?.vo2max.latest,
        vo2max_trend_delta_mlkgmin: analysis?.vo2max.trendDelta,
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
    const detail = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(detail?.detail || `KI-Backend antwortete mit ${response.status}.`)
  }
  const result = (await response.json()) as TrainingPlanResponse
  if (!result.plan || !result.plan.week_summary || !Array.isArray(result.plan.days))
    throw new Error('Das KI-Ergebnis hat kein gültiges Planformat.')
  return result
}
