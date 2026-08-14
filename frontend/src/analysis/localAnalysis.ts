import type { AnalysisSummary, UserConfig, Workout } from '../types/workout'
import { isoWeekStart, normalizeSport } from './analysisEngine'

export function calculateAnalysis(workouts: Workout[], config: UserConfig): AnalysisSummary {
  const weeks = new Map<
    string,
    {
      workoutCount: number
      distanceKm: number
      durationMinutes: number
      load: number
      heartRates: number[]
      calories: number
      elevationGainM: number
      sports: Record<string, { workoutCount: number; durationMinutes: number; distanceKm: number; trainingLoad: number }>
    }
  >()
  const zoneMinutes: Record<string, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  let totalDistanceKm = 0,
    totalDurationMinutes = 0,
    totalCalories = 0,
    totalElevationGainM = 0
  for (const workout of workouts) {
    const durationMinutes = Number.isFinite(workout.durationSeconds) ? Math.max(0, workout.durationSeconds / 60) : 0
    const distanceKm = Number.isFinite(workout.distanceKm) ? Math.max(0, workout.distanceKm || 0) : 0
    const week = isoWeekStart(workout.date)
    if (!week) continue
    const current = weeks.get(week) || { workoutCount: 0, distanceKm: 0, durationMinutes: 0, load: 0, heartRates: [], calories: 0, elevationGainM: 0, sports: {} }
    current.workoutCount += 1
    current.distanceKm += distanceKm
    current.durationMinutes += durationMinutes
    current.load += (durationMinutes * (workout.averageHeartRate || 0)) / (config.thresholds.lthr || 160)
    current.calories += workout.calories || 0
    current.elevationGainM += workout.elevationGainM ?? workout.ascentM ?? 0
    const sport = normalizeSport(workout.sport)
    const sportMetrics = current.sports[sport] || { workoutCount: 0, durationMinutes: 0, distanceKm: 0, trainingLoad: 0 }
    sportMetrics.workoutCount += 1
    sportMetrics.durationMinutes += durationMinutes
    sportMetrics.distanceKm += distanceKm
    sportMetrics.trainingLoad += (durationMinutes * (workout.averageHeartRate || 0)) / (config.thresholds.lthr || 160)
    current.sports[sport] = sportMetrics
    if (workout.averageHeartRate) current.heartRates.push(workout.averageHeartRate)
    weeks.set(week, current)
    totalDistanceKm += distanceKm
    totalDurationMinutes += durationMinutes
    totalCalories += workout.calories || 0
    totalElevationGainM += workout.elevationGainM ?? workout.ascentM ?? 0
    for (const record of workout.records) {
      if (record.heartRateBpm === undefined) continue
      const zone = Object.entries(config.hrZones).find(
        ([, range]) => record.heartRateBpm! >= range[0] && record.heartRateBpm! <= range[1],
      )?.[0]
      if (zone) zoneMinutes[zone] += 1 / 60
    }
  }
  return {
    totalDistanceKm,
    totalDurationMinutes,
    totalCalories,
    totalElevationGainM,
    zoneMinutes,
    weekly: [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStartValue, value]) => ({
        weekStart: weekStartValue,
        workoutCount: value.workoutCount,
        distanceKm: value.distanceKm,
        durationMinutes: value.durationMinutes,
        trainingLoad: value.load,
        averageHeartRate: value.heartRates.length
          ? value.heartRates.reduce((a, b) => a + b, 0) / value.heartRates.length
          : undefined,
        calories: value.calories,
        elevationGainM: value.elevationGainM,
        sports: value.sports,
      })),
  }
}
