import { SPORT_CATEGORIES, type SportCategory, type UserConfig, type Workout } from '../types/workout'

export type Sport = SportCategory

export interface WeeklyMetric {
  weekStart: string
  totalMinutes: number
  runningMinutes: number
  cyclingMinutes: number
  runningDistanceKm: number
  cyclingDistanceKm: number
  sports: Partial<Record<SportCategory, { minutes: number; distanceKm: number; workoutCount: number }>>
}

export interface LoadDay {
  date: string
  trimp: number
  ctl: number
  atl: number
  tsb: number
  acwr?: number
  risk?: 'low' | 'optimal' | 'spike'
}

export interface FosterWeek {
  weekStart: string
  load: number
  monotony?: number
  strain?: number
}

export interface PolarizationWeek {
  weekStart: string
  z1Minutes: number
  z2Minutes: number
  z3Minutes: number
  z1Pct: number
  z2Pct: number
  z3Pct: number
  polarizationIndex?: number
}

export interface HrZoneWeek {
  weekStart: string
  minutes: number[]
  percentages: number[]
}

export interface EfficiencyPoint {
  date: string
  efficiency: number
  workoutId: string
}

export interface SportMetrics {
  sport: SportCategory
  workoutCount: number
  durationMinutes: number
  distanceKm: number
  calories: number
  elevationGainM: number
  averageHeartRate?: number
  averagePaceSecondsPerKm?: number
  averageSpeedKmh?: number
  averagePowerW?: number
  swimmingDistanceM?: number
  swimmingLaps?: number
  swimmingStrokes?: number
}

export interface AnalysisResult {
  weekly: WeeklyMetric[]
  load: LoadDay[]
  foster: FosterWeek[]
  fosterRpe: FosterWeek[]
  polarization: PolarizationWeek[]
  hrZones: HrZoneWeek[]
  efficiency: EfficiencyPoint[]
  sports: SportMetrics[]
  triathlonGroups: Array<{ id: string; workouts: string[]; disciplines: Array<{ sport: string; order?: number }> }>
}

export function calculateSportMetrics(workouts: Workout[]): SportMetrics[] {
  const map = new Map<SportCategory, SportMetrics>()
  for (const workout of workouts) {
    const sport = normalizeSport(workout.sport) as SportCategory
    const item = map.get(sport) || { sport, workoutCount: 0, durationMinutes: 0, distanceKm: 0, calories: 0, elevationGainM: 0 }
    item.workoutCount += 1
    item.durationMinutes += Math.max(0, workout.durationSeconds || 0) / 60
    item.distanceKm += workout.distanceKm || 0
    item.calories += workout.calories || 0
    item.elevationGainM += workout.elevationGainM ?? workout.ascentM ?? 0
    if (Number.isFinite(workout.averageHeartRate)) item.averageHeartRate = ((item.averageHeartRate || 0) * (item.workoutCount - 1) + workout.averageHeartRate!) / item.workoutCount
    if (Number.isFinite(workout.averageSpeedKmh)) item.averageSpeedKmh = ((item.averageSpeedKmh || 0) * (item.workoutCount - 1) + workout.averageSpeedKmh!) / item.workoutCount
    if (Number.isFinite(workout.averagePowerW)) item.averagePowerW = ((item.averagePowerW || 0) * (item.workoutCount - 1) + workout.averagePowerW!) / item.workoutCount
    item.swimmingDistanceM = (item.swimmingDistanceM || 0) + (workout.swimmingDistanceM || 0) || undefined
    item.swimmingLaps = (item.swimmingLaps || 0) + (workout.swimmingLaps || 0) || undefined
    item.swimmingStrokes = (item.swimmingStrokes || 0) + (workout.swimmingStrokes || 0) || undefined
    if (workout.averagePaceSecondsPerKm !== undefined) item.averagePaceSecondsPerKm = ((item.averagePaceSecondsPerKm || 0) * (item.workoutCount - 1) + workout.averagePaceSecondsPerKm) / item.workoutCount
    map.set(sport, item)
  }
  return [...map.values()].sort((a, b) => a.sport.localeCompare(b.sport))
}

export function calculateTriathlonGroups(workouts: Workout[]) {
  const groups = new Map<string, Workout[]>()
  for (const workout of workouts) if (workout.multisportGroupId) groups.set(workout.multisportGroupId, [...(groups.get(workout.multisportGroupId) || []), workout])
  return [...groups].map(([id, items]) => ({ id, workouts: items.sort((a, b) => (a.multisportOrder || 99) - (b.multisportOrder || 99)).map((item) => item.id), disciplines: items.map((item) => ({ sport: item.multisportDiscipline || normalizeSport(item.sport), order: item.multisportOrder })) }))
}

export function normalizeSport(value: string): string {
  const sport = (value || '').trim().toLowerCase()
  if (['running', 'run', 'jogging'].includes(sport)) return 'Running'
  if (['cycling', 'ride', 'biking', 'bike'].includes(sport)) return 'Cycling'
  if (['swimming', 'swim', 'pool_swimming'].includes(sport)) return 'Swimming'
  if (['hiking', 'hike', 'trekking', 'mountaineering'].includes(sport)) return 'Hiking'
  if (['walking', 'walk'].includes(sport)) return 'Walking'
  if (['triathlon', 'multisport', 'multi_sport'].includes(sport)) return 'Triathlon'
  const title = sport ? sport[0].toUpperCase() + sport.slice(1) : 'Other'
  return SPORT_CATEGORIES.includes(title as SportCategory) ? title : 'Other'
}

export function toDateKey(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const dmy = value.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

export function isoWeekStart(value: string): string {
  const key = toDateKey(value)
  if (!key) return ''
  const date = new Date(`${key}T00:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
}

function daysBetween(start: string, end: string): string[] {
  const result: string[] = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return result
}

function weekMap<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const week = key(item)
    if (!week) continue
    map.set(week, [...(map.get(week) || []), item])
  }
  return map
}

export function calculateWeeklyMetrics(workouts: Workout[]): WeeklyMetric[] {
  const map = new Map<string, WeeklyMetric>()
  for (const workout of workouts) {
    const weekStart = isoWeekStart(workout.date)
    if (!weekStart) continue
    const sport = normalizeSport(workout.sport)
    const item = map.get(weekStart) || {
      weekStart,
      totalMinutes: 0,
      runningMinutes: 0,
      cyclingMinutes: 0,
      runningDistanceKm: 0,
      cyclingDistanceKm: 0,
      sports: {},
    }
    const minutes = Math.max(0, workout.durationSeconds || 0) / 60
    item.totalMinutes += minutes
    if (sport === 'Running') {
      item.runningMinutes += minutes
      if (finite(workout.distanceKm)) item.runningDistanceKm += workout.distanceKm
    }
    if (sport === 'Cycling') {
      item.cyclingMinutes += minutes
      if (finite(workout.distanceKm)) item.cyclingDistanceKm += workout.distanceKm
    }
    const sportMetrics = item.sports[sport as SportCategory] || { minutes: 0, distanceKm: 0, workoutCount: 0 }
    sportMetrics.minutes += minutes
    sportMetrics.distanceKm += finite(workout.distanceKm) ? workout.distanceKm! : 0
    sportMetrics.workoutCount += 1
    item.sports[sport as SportCategory] = sportMetrics
    map.set(weekStart, item)
  }
  return [...map.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export function calculateTrimp(workout: Workout, hrRest = 55, hrMax = 186): number {
  const duration = Math.max(0, workout.durationSeconds || 0) / 60
  const hr = workout.averageHeartRate
  if (!finite(hr) || hrMax <= hrRest) return 0
  const delta = Math.max(0, (hr - hrRest) / (hrMax - hrRest))
  return duration * delta * 0.64 * Math.exp(1.92 * delta)
}

export function calculateTrainingLoad(workouts: Workout[], config?: UserConfig): LoadDay[] {
  const valid = workouts
    .map((w) => ({
      date: toDateKey(w.date),
      trimp: calculateTrimp(w, config?.thresholds.hr_rest || 55, config?.thresholds.hr_max || 186),
    }))
    .filter((x) => x.date)
  if (!valid.length) return []
  const daily = new Map<string, number>()
  for (const item of valid) daily.set(item.date, (daily.get(item.date) || 0) + item.trimp)
  const dates = daysBetween([...daily.keys()].sort()[0], [...daily.keys()].sort().at(-1) as string)
  const alpha = (tau: number) => 1 - Math.exp(-1 / tau)
  let ctl = 0
  let atl = 0
  return dates.map((date) => {
    const trimp = daily.get(date) || 0
    ctl += alpha(42) * (trimp - ctl)
    atl += alpha(7) * (trimp - atl)
    const acwr = ctl > 1e-6 ? atl / ctl : undefined
    return {
      date,
      trimp,
      ctl,
      atl,
      tsb: ctl - atl,
      acwr,
      risk: acwr === undefined ? undefined : acwr < 0.8 ? 'low' : acwr <= 1.3 ? 'optimal' : 'spike',
    }
  })
}

function fosterFromDaily(load: Array<{ date: string; value: number }>): FosterWeek[] {
  return [...weekMap(load, (item) => isoWeekStart(item.date)).entries()]
    .map(([weekStart, entries]) => {
      const values = entries.map((x) => x.value)
      const weekLoad = values.reduce((a, b) => a + b, 0)
      if (weekLoad === 0) return { weekStart, load: 0, monotony: 0, strain: 0 }
      const mean = weekLoad / values.length
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1)
      const std = Math.sqrt(variance)
      if (std === 0) return { weekStart, load: weekLoad }
      const monotony = mean / std
      return { weekStart, load: weekLoad, monotony, strain: monotony * weekLoad }
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export function calculateFosterMetrics(workouts: Workout[], config?: UserConfig): FosterWeek[] {
  return fosterFromDaily(calculateTrainingLoad(workouts, config).map((x) => ({ date: x.date, value: x.trimp })))
}

export function calculateRpeFosterMetrics(workouts: Workout[]): FosterWeek[] {
  return fosterFromDaily(
    workouts
      .filter((w) => finite(w.sessionRpe) && w.sessionRpe >= 1 && w.sessionRpe <= 10)
      .map((w) => ({
        date: toDateKey(w.date),
        value: (Math.max(0, w.durationSeconds) / 60) * (w.sessionRpe as number),
      }))
      .filter((x) => x.date),
  )
}

export function calculateAcwr(load: LoadDay[]): LoadDay[] {
  return load.filter((x) => x.ctl > 0).map((x) => x)
}

function recordSeconds(workout: Workout, index: number): number {
  const current = workout.records[index]?.elapsedSeconds
  const next = workout.records[index + 1]?.elapsedSeconds
  const delta = finite(current) && finite(next) ? next - current : NaN
  return delta > 0 && delta <= 3600 ? delta : 1
}

export function calculatePolarization(workouts: Workout[], config: UserConfig): PolarizationWeek[] {
  const t1 = config.hrZones.z2?.[1] ?? 124
  const t2 = config.thresholds.lthr || 160
  const map = new Map<string, PolarizationWeek>()
  for (const w of workouts) {
    const hr = w.averageHeartRate
    if (!finite(hr)) continue
    const weekStart = isoWeekStart(w.date)
    const item = map.get(weekStart) || {
      weekStart,
      z1Minutes: 0,
      z2Minutes: 0,
      z3Minutes: 0,
      z1Pct: 0,
      z2Pct: 0,
      z3Pct: 0,
    }
    const key = hr <= t1 ? 'z1Minutes' : hr <= t2 ? 'z2Minutes' : 'z3Minutes'
    item[key] += Math.max(0, w.durationSeconds) / 60
    map.set(weekStart, item)
  }
  return [...map.values()]
    .map((item) => {
      const total = item.z1Minutes + item.z2Minutes + item.z3Minutes
      item.z1Pct = total ? (item.z1Minutes / total) * 100 : 0
      item.z2Pct = total ? (item.z2Minutes / total) * 100 : 0
      item.z3Pct = total ? (item.z3Minutes / total) * 100 : 0
      item.polarizationIndex = item.z2Minutes ? item.z3Minutes / item.z2Minutes : undefined
      return item
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export function calculateHrZoneDistribution(workouts: Workout[], config: UserConfig): HrZoneWeek[] {
  const zones = Object.values(config.hrZones)
  const map = new Map<string, number[]>()
  for (const w of workouts) {
    const week = isoWeekStart(w.date)
    if (!week || !w.records.length) continue
    const minutes = map.get(week) || zones.map(() => 0)
    w.records.forEach((r, i) => {
      if (!finite(r.heartRateBpm)) return
      const index = zones.findIndex(([min, max]) => r.heartRateBpm! >= min && r.heartRateBpm! <= max)
      if (index >= 0) minutes[index] += recordSeconds(w, i) / 60
    })
    map.set(week, minutes)
  }
  return [...map.entries()]
    .map(([weekStart, minutes]) => {
      const total = minutes.reduce((a, b) => a + b, 0)
      return { weekStart, minutes, percentages: minutes.map((x) => (total ? (x / total) * 100 : 0)) }
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export function calculateEfficiency(workouts: Workout[]): EfficiencyPoint[] {
  return workouts
    .filter(
      (w) =>
        normalizeSport(w.sport) === 'Running' &&
        finite(w.distanceKm) &&
        w.distanceKm > 0 &&
        w.durationSeconds > 0 &&
        finite(w.averageHeartRate) &&
        w.averageHeartRate > 0,
    )
    .map((w) => ({
      date: toDateKey(w.date),
      workoutId: w.id,
      efficiency: w.distanceKm! / (w.durationSeconds / 3600) / w.averageHeartRate!,
    }))
    .filter((x) => x.date && Number.isFinite(x.efficiency))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function calculateAnalysis(workouts: Workout[], config: UserConfig): AnalysisResult {
  const load = calculateTrainingLoad(workouts, config)
  return {
    weekly: calculateWeeklyMetrics(workouts),
    load,
    foster: calculateFosterMetrics(workouts, config),
    fosterRpe: calculateRpeFosterMetrics(workouts),
    polarization: calculatePolarization(workouts, config),
    hrZones: calculateHrZoneDistribution(workouts, config),
    efficiency: calculateEfficiency(workouts),
    sports: calculateSportMetrics(workouts),
    triathlonGroups: calculateTriathlonGroups(workouts),
  }
}
