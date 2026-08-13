import type {AnalysisSummary, UserConfig, Workout} from '../types/workout'

function weekStart(date: string): string {
    const match = date.match(/^(\d{2})-(\d{2})-(\d{4})$/)
    const value = match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : new Date(date)
    if (Number.isNaN(value.getTime())) return 'unknown'
    const day = value.getDay() || 7
    value.setDate(value.getDate() - day + 1)
    return value.toISOString().slice(0, 10)
}

export function calculateAnalysis(workouts: Workout[], config: UserConfig): AnalysisSummary {
    const weeks = new Map<string, {
        workoutCount: number;
        distanceKm: number;
        durationMinutes: number;
        load: number;
        heartRates: number[]
    }>()
    const zoneMinutes: Record<string, number> = {z1: 0, z2: 0, z3: 0, z4: 0, z5: 0}
    let totalDistanceKm = 0, totalDurationMinutes = 0
    for (const workout of workouts) {
        const durationMinutes = workout.durationSeconds / 60
        const distanceKm = workout.distanceKm || 0
        const week = weekStart(workout.date)
        const current = weeks.get(week) || {workoutCount: 0, distanceKm: 0, durationMinutes: 0, load: 0, heartRates: []}
        current.workoutCount += 1;
        current.distanceKm += distanceKm;
        current.durationMinutes += durationMinutes
        current.load += durationMinutes * (workout.averageHeartRate || 0) / (config.thresholds.lthr || 160)
        if (workout.averageHeartRate) current.heartRates.push(workout.averageHeartRate)
        weeks.set(week, current)
        totalDistanceKm += distanceKm;
        totalDurationMinutes += durationMinutes
        for (const record of workout.records) {
            if (record.heartRateBpm === undefined) continue
            const zone = Object.entries(config.hrZones).find(([, range]) => record.heartRateBpm! >= range[0] && record.heartRateBpm! <= range[1])?.[0]
            if (zone) zoneMinutes[zone] += 1 / 60
        }
    }
    return {
        totalDistanceKm,
        totalDurationMinutes,
        zoneMinutes,
        weekly: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStartValue, value]) => ({
            weekStart: weekStartValue,
            workoutCount: value.workoutCount,
            distanceKm: value.distanceKm,
            durationMinutes: value.durationMinutes,
            trainingLoad: value.load,
            averageHeartRate: value.heartRates.length ? value.heartRates.reduce((a, b) => a + b, 0) / value.heartRates.length : undefined
        }))
    }
}
