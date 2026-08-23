export type PlanSport =
  'running' | 'cycling' | 'swimming' | 'hiking' | 'cardio' | 'rowing' | 'strength' | 'mobility' | 'other'

export type PlanSessionType = 'training' | 'rest'

export interface PlanStep {
  step_duration: string
  step_intensity: string
  step_instruction: string
}

export interface PlanDay {
  date: string
  day: string
  sport: PlanSport
  /** Display name for custom sports when sport is `other`. */
  sport_label?: string
  session_type: PlanSessionType
  title: string
  description: string
  target_focus: string
  total_duration_minutes: number
  workout_steps: PlanStep[]
}

export interface TrainingPlanLike {
  start_date?: string
  week_summary: { focus_title: string; goal_description: string }
  days: PlanDay[]
}

export interface SanitizedWorkout {
  date?: string
  sport: string
  duration_minutes: number
  distance_km?: number
  avg_hr?: number
  elevation_gain_m?: number | null
  confidence: 'high' | 'low'
  elevation_noisy?: boolean
}

export interface SanitizedInputs {
  weekly: Array<{ week_start?: string; total_minutes: number }>
  recent_workouts: SanitizedWorkout[]
  best_recent_week_minutes: number
  longest_reliable_run_minutes: number
  reliable_run_count: number
  signals: {
    hr_zones_may_be_miscalibrated: boolean
    short_segment_count: number
    elevation_outlier_count: number
  }
  latest_load: {
    ctl?: number
    atl?: number
    tsb?: number
    acwr?: number
    risk?: string
  } | null
}

export interface LoadBudget {
  /** Endurance-only weekly minutes (running/cycling/etc). Strength is separate. */
  max_total_training_minutes: number
  max_long_run_minutes: number
  max_quality_sessions: number
  /** All structured sessions combined, including strength and mobility. */
  max_training_sessions: number
  max_endurance_sessions: number
  max_strength_sessions: number
  max_strength_minutes_per_session: number
  max_strength_minutes_total: number
  max_training_minutes_per_day: Record<string, number>
  allow_quality: boolean
  resume_long: boolean
  recovery_week: boolean
}

const ENDURANCE_SPORTS = new Set(['running', 'cycling', 'swimming', 'hiking', 'cardio', 'rowing'])
const KNOWN_PLAN_SPORTS = new Set([
  'running',
  'cycling',
  'swimming',
  'hiking',
  'cardio',
  'rowing',
  'strength',
  'mobility',
  'other',
])
/** Hard-session markers. Avoid matching everyday German "Tempo" / Konversationstempo. */
const QUALITY_TOKEN = String.raw`intervalle?|intervall(?:e|s)?|tempolauf|tempo(?:\s+run|\s+session|\s+intervals?)|threshold|quality|vo2(?:max)?|fartlek|wettkampfpace|speed\s*work|schnelligkeit|\bschnell\b`
const QUALITY_PATTERN = new RegExp(QUALITY_TOKEN, 'i')

function qualitySearchText(value: string): string {
  return value
    .replace(/konversationstempo/gi, ' ')
    .replace(/unterhaltungstempo/gi, ' ')
    .replace(/gesprächstempo/gi, ' ')
    .replace(/conversational(?:\s+(?:pace|tempo))?/gi, ' ')
    .replace(/\b(?:angenehmes?|lockeres?|ruhiges?|entspanntes?|gleichmäßiges?|moderates?)\s+tempo\b/gi, ' ')
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function normalizeSportKey(value: unknown): string {
  const sport = String(value ?? '')
    .trim()
    .toLowerCase()
  const aliases: Record<string, string> = {
    run: 'running',
    running: 'running',
    ride: 'cycling',
    bike: 'cycling',
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
    indoor: 'cardio',
    row: 'cardio',
    rowing: 'cardio',
    strength: 'strength',
    mobility: 'mobility',
    yoga: 'mobility',
    rest: 'other',
    recovery: 'other',
    other: 'other',
  }
  return aliases[sport] || sport
}

function isShortSegment(duration: number, distanceKm: number | undefined): boolean {
  return duration < 15 && (distanceKm === undefined || distanceKm <= 1.5)
}

function isElevationOutlier(distanceKm: number | undefined, elevation: number | undefined): boolean {
  if (!distanceKm || distanceKm <= 0 || elevation === undefined) return false
  return elevation / distanceKm > 80
}

export function sanitizePlanInputs(input: {
  metrics?: Record<string, unknown>
  recent_workouts?: Array<Record<string, unknown>>
  workouts?: Array<Record<string, unknown>>
  profile?: Record<string, unknown>
}): SanitizedInputs {
  const metrics = asRecord(input.metrics)
  const weeklyRaw = Array.isArray(metrics.weekly) ? metrics.weekly : []
  const weekly = weeklyRaw
    .map((week) => {
      const item = asRecord(week)
      return {
        week_start: typeof item.week_start === 'string' ? item.week_start : undefined,
        total_minutes: Math.max(0, asNumber(item.total_minutes) ?? 0),
      }
    })
    .filter((week) => week.total_minutes > 0)
    .slice(-4)

  const best_recent_week_minutes = weekly.length ? Math.max(...weekly.map((week) => week.total_minutes)) : 0

  const rawWorkouts = (input.recent_workouts?.length ? input.recent_workouts : input.workouts) || []
  let short_segment_count = 0
  let elevation_outlier_count = 0
  const recent_workouts: SanitizedWorkout[] = rawWorkouts.map((workout) => {
    const item = asRecord(workout)
    const duration = Math.max(0, Math.round(asNumber(item.duration_minutes) ?? 0))
    const distance = asNumber(item.distance_km)
    const elevation = asNumber(item.elevation_gain_m)
    const short = isShortSegment(duration, distance)
    const elevNoisy = isElevationOutlier(distance, elevation)
    if (short) short_segment_count += 1
    if (elevNoisy) elevation_outlier_count += 1
    return {
      date: typeof item.date === 'string' ? item.date : undefined,
      sport: normalizeSportKey(item.sport),
      duration_minutes: duration,
      distance_km: distance,
      avg_hr: asNumber(item.avg_hr),
      elevation_gain_m: elevNoisy ? null : (elevation ?? null),
      confidence: short ? 'low' : 'high',
      elevation_noisy: elevNoisy || undefined,
    }
  })

  const reliableRuns = recent_workouts.filter(
    (workout) => workout.sport === 'running' && workout.confidence === 'high' && workout.duration_minutes > 0,
  )
  const longest_reliable_run_minutes = reliableRuns.length
    ? Math.max(...reliableRuns.map((workout) => workout.duration_minutes))
    : 0

  const hrZones = asRecord(input.profile?.hr_zones)
  const z2 = Array.isArray(hrZones.z2)
    ? hrZones.z2.map((value) => asNumber(value)).filter((value): value is number => value !== undefined)
    : []
  const z2High = z2.length >= 2 ? z2[1] : undefined
  const reliableHrs = reliableRuns
    .map((workout) => workout.avg_hr)
    .filter((value): value is number => value !== undefined)
  const medianHr = median(reliableHrs)
  const hr_zones_may_be_miscalibrated = Boolean(
    z2High !== undefined && medianHr !== undefined && medianHr > z2High + 10,
  )

  const latestLoadRaw = metrics.latest_load
  const latestLoad =
    latestLoadRaw && typeof latestLoadRaw === 'object' && !Array.isArray(latestLoadRaw)
      ? {
          ctl: asNumber((latestLoadRaw as Record<string, unknown>).ctl),
          atl: asNumber((latestLoadRaw as Record<string, unknown>).atl),
          tsb: asNumber((latestLoadRaw as Record<string, unknown>).tsb),
          acwr: asNumber((latestLoadRaw as Record<string, unknown>).acwr),
          risk:
            typeof (latestLoadRaw as Record<string, unknown>).risk === 'string'
              ? String((latestLoadRaw as Record<string, unknown>).risk)
              : undefined,
        }
      : null

  return {
    weekly,
    recent_workouts,
    best_recent_week_minutes,
    longest_reliable_run_minutes,
    reliable_run_count: reliableRuns.length,
    signals: {
      hr_zones_may_be_miscalibrated,
      short_segment_count,
      elevation_outlier_count,
    },
    latest_load: latestLoad,
  }
}

export function computeLoadBudget(sanitized: SanitizedInputs, profile: Record<string, unknown> = {}): LoadBudget {
  const best = sanitized.best_recent_week_minutes
  let maxEndurance: number
  if (best <= 0) {
    maxEndurance = 30
  } else if (best < 40) {
    maxEndurance = Math.round(Math.max(best * 1.25, best + 15))
  } else {
    maxEndurance = Math.round(Math.max(best * 1.25, 45))
  }

  const max_training_minutes_per_day: Record<string, number> = {}
  const longest = sanitized.longest_reliable_run_minutes
  const resume_long = longest >= 45 && longest >= Math.max(best * 2, best + 30)

  let maxLong: number
  if (resume_long) {
    // Resume: allow a meaningful long based on proven ability, not crushed by a weak recent week.
    maxLong = Math.round(Math.min(60, Math.max(45, longest * 0.5)))
  } else if (longest >= 15) {
    maxLong = Math.round(Math.max(longest * 1.2, Math.min(longest + 10, 35)))
    maxLong = Math.min(maxLong, Math.round(maxEndurance * 0.55), 90)
  } else if (longest > 0) {
    maxLong = Math.round(Math.min(longest + 10, 25))
    maxLong = Math.min(maxLong, Math.round(maxEndurance * 0.55), 90)
  } else {
    maxLong = Math.min(20, Math.round(maxEndurance * 0.55))
  }
  maxLong = Math.max(0, maxLong)

  if (resume_long) {
    // Keep room for one short supporting run alongside the long.
    maxEndurance = Math.max(maxEndurance, maxLong + 15)
  }

  const ctl = sanitized.latest_load?.ctl ?? 0
  const tsb = sanitized.latest_load?.tsb
  const acwr = sanitized.latest_load?.acwr
  const risk = (sanitized.latest_load?.risk || '').toLowerCase()
  const lowConsistency = sanitized.reliable_run_count < 2 || best < 40
  const limitations = String(profile.limitations || '').toLowerCase()
  const activeLimitation = /\b(?:pain|injur|ache|schmerz|verletz|beschwerd|entzünd|reizung|rehab)/i.test(limitations)
  const recovery_week = risk === 'spike' || (tsb !== undefined && tsb <= -20) || (acwr !== undefined && acwr >= 1.5)
  const allow_quality = ctl >= 20 && !recovery_week && !activeLimitation && !lowConsistency

  const preferredDays = Array.isArray(profile.preferred_training_days)
    ? profile.preferred_training_days.map((day) => String(day).toLowerCase()).filter(Boolean)
    : []
  const frequency = asNumber(profile.training_frequency_per_week)
  const derivedFrequency = preferredDays.length || 3
  const requestedFrequency = Math.max(
    1,
    Math.min(7, Math.round(frequency && frequency > 0 ? frequency : derivedFrequency)),
  )
  const max_training_sessions = recovery_week ? Math.min(3, requestedFrequency) : requestedFrequency
  const trainingGoal = String(profile.training_goal || '').toLowerCase()
  const max_quality_sessions = !allow_quality
    ? 0
    : trainingGoal === 'vo2max' && max_training_sessions >= 4
      ? 2
      : 1
  const max_endurance_sessions = resume_long ? Math.min(2, max_training_sessions) : max_training_sessions
  const strengthEnabled =
    Boolean(profile.strength_training) ||
    (Array.isArray(profile.available_sports) && profile.available_sports.map(normalizeSportKey).includes('strength'))
  const max_strength_sessions = strengthEnabled ? 2 : 0
  const max_strength_minutes_per_session = strengthEnabled ? 35 : 0
  const max_strength_minutes_total = strengthEnabled
    ? Math.min(70, max_strength_sessions * max_strength_minutes_per_session)
    : 0

  if (recovery_week && best > 0) {
    maxEndurance = Math.min(maxEndurance, Math.max(30, Math.round(best * 0.6)))
    maxLong = Math.min(maxLong, Math.round(maxEndurance * 0.45))
  }

  return {
    max_total_training_minutes: Math.max(0, maxEndurance),
    max_long_run_minutes: maxLong,
    max_quality_sessions,
    max_training_sessions,
    max_endurance_sessions,
    max_strength_sessions,
    max_strength_minutes_per_session,
    max_strength_minutes_total,
    max_training_minutes_per_day,
    allow_quality,
    resume_long,
    recovery_week,
  }
}

export function formatHardCapsBlock(budget: LoadBudget): string {
  return [
    'HARD_CAPS (must not exceed; server will clamp):',
    `max_endurance_minutes: ${budget.max_total_training_minutes}`,
    `max_long_run_minutes: ${budget.max_long_run_minutes}`,
    `max_quality_sessions: ${budget.max_quality_sessions}`,
    `max_training_sessions: ${budget.max_training_sessions}`,
    `max_endurance_sessions: ${budget.max_endurance_sessions}`,
    `max_strength_sessions: ${budget.max_strength_sessions}`,
    `max_strength_minutes_per_session: ${budget.max_strength_minutes_per_session}`,
    `max_strength_minutes_total: ${budget.max_strength_minutes_total}`,
    `resume_long: ${budget.resume_long}`,
    `recovery_week: ${budget.recovery_week}`,
    `max_training_minutes_per_day: ${JSON.stringify(budget.max_training_minutes_per_day)}`,
    'Strength minutes do NOT count against max_endurance_minutes.',
  ].join('\n')
}

function partitionAvailableSports(profile: Record<string, unknown>): { known: Set<string>; custom: Set<string> } {
  const list = Array.isArray(profile.available_sports) ? profile.available_sports : []
  const known = new Set<string>()
  const custom = new Set<string>()
  for (const item of list) {
    const raw = String(item ?? '').trim()
    if (!raw) continue
    const exact = raw.toLowerCase()
    // Exact enum match only — do not fold custom labels through aliases (e.g. "Yoga" must stay custom).
    if (KNOWN_PLAN_SPORTS.has(exact) && exact !== 'other') known.add(exact)
    else custom.add(raw)
  }
  if (profile.strength_training) known.add('strength')
  if (!known.size && !custom.size) known.add('running')
  return { known, custom }
}

function findCustomSportLabel(label: string | undefined, custom: Set<string>): string | undefined {
  const raw = label?.trim()
  if (!raw) return undefined
  for (const item of custom) {
    if (item.toLowerCase() === raw.toLowerCase()) return item
  }
  return undefined
}

function isAllowedTrainingSport(day: PlanDay, known: Set<string>, custom: Set<string>): boolean {
  if (day.session_type === 'rest') return true
  if (day.sport !== 'other' && known.has(day.sport)) return true
  if (day.sport === 'other') return Boolean(findCustomSportLabel(day.sport_label, custom))
  return false
}

export function isQualitySession(day: PlanDay): boolean {
  if (day.session_type === 'rest') return false
  const blob = qualitySearchText(
    [
      day.title,
      day.description,
      day.target_focus,
      ...day.workout_steps.map((step) => `${step.step_intensity} ${step.step_instruction}`),
    ].join(' '),
  )
  return QUALITY_PATTERN.test(blob)
}

function toRestDay(day: PlanDay, reason: string, locale: 'de' | 'en' = 'en'): PlanDay {
  const recovery = locale === 'de' ? 'Erholung' : 'Recovery'
  return {
    ...day,
    sport: 'other',
    sport_label: undefined,
    session_type: 'rest',
    title: day.title || 'Rest',
    description: reason,
    target_focus: recovery,
    total_duration_minutes: 0,
    workout_steps: [
      {
        step_duration: '0 min',
        step_intensity: locale === 'de' ? 'Ruhe' : 'Rest',
        step_instruction: reason,
      },
    ],
  }
}

/** Soften hard cues without wiping coach language into English boilerplate. */
function softenQuality(day: PlanDay): PlanDay {
  const softenText = (value: string) =>
    value
      .replace(/\bintervalle?\b/gi, 'locker')
      .replace(/\bintervall(?:e|s)?\b/gi, 'locker')
      .replace(/\btempolauf\b/gi, 'lockerer Lauf')
      .replace(/\btempo(?:\s+run|\s+session|\s+intervals?)\b/gi, 'locker')
      .replace(/\bthreshold\b/gi, 'locker')
      .replace(/\bquality\b/gi, 'easy')
      .replace(/\bvo2(?:max)?\b/gi, 'easy')
      .replace(/\bfartlek\b/gi, 'locker')
      .replace(/\bwettkampfpace\b/gi, 'lockeres Tempo')
      .replace(/\bspeed\s*work\b/gi, 'lockere Einheit')
      .replace(/\bschnelligkeit\b/gi, 'Grundlage')
      .replace(/\bschnell\b/gi, 'locker')

  return {
    ...day,
    title: softenText(day.title),
    description: QUALITY_PATTERN.test(qualitySearchText(day.description))
      ? `${softenText(day.description)} Bleib locker und unterhaltungsfähig.`
      : day.description,
    target_focus: softenText(day.target_focus),
    workout_steps: day.workout_steps.map((step) => {
      const hardIntensity = QUALITY_PATTERN.test(qualitySearchText(step.step_intensity))
      const hardInstruction = QUALITY_PATTERN.test(qualitySearchText(step.step_instruction))
      return {
        ...step,
        step_intensity: hardIntensity ? softenText(step.step_intensity) : step.step_intensity,
        step_instruction: hardInstruction
          ? `${softenText(step.step_instruction)} Bleib locker und unterhaltungsfähig.`
          : step.step_instruction,
      }
    }),
  }
}

function parseStepMinutes(value: string): number | undefined {
  const match = value.match(/(\d+(?:\.\d+)?)\s*min/i)
  return match ? Number(match[1]) : undefined
}

function scaleStepsToDuration(day: PlanDay, targetMinutes: number): PlanDay {
  const current = Math.max(1, day.total_duration_minutes)
  const ratio = targetMinutes / current
  const steps = day.workout_steps.map((step, index) => {
    const minutes = parseStepMinutes(step.step_duration)
    if (minutes === undefined) return step
    const isEdge = index === 0 || index === day.workout_steps.length - 1
    const next = isEdge
      ? Math.max(3, Math.round(minutes * Math.min(1, ratio)))
      : Math.max(5, Math.round(minutes * ratio))
    return { ...step, step_duration: `${next} min` }
  })
  const summed = steps.reduce((sum, step) => sum + (parseStepMinutes(step.step_duration) || 0), 0)
  if (summed > 0 && steps.length >= 2) {
    const mainIndex = Math.min(1, steps.length - 1)
    const mainMinutes = parseStepMinutes(steps[mainIndex].step_duration) || 0
    const delta = targetMinutes - summed
    steps[mainIndex] = {
      ...steps[mainIndex],
      step_duration: `${Math.max(5, mainMinutes + delta)} min`,
    }
  }
  return { ...day, total_duration_minutes: targetMinutes, workout_steps: steps }
}

function clampDayToLimit(day: PlanDay, limit: number | undefined): PlanDay {
  if (!limit || day.session_type === 'rest' || day.total_duration_minutes <= limit) return day
  return scaleStepsToDuration(day, limit)
}

export function reviewAndClampPlan(
  plan: TrainingPlanLike,
  budget: LoadBudget,
  profile: Record<string, unknown> = {},
  locale: 'de' | 'en' = 'en',
): { plan: TrainingPlanLike; repairs: string[] } {
  const repairs: string[] = []
  const { known, custom } = partitionAvailableSports(profile)
  const preferred = Array.isArray(profile.preferred_training_days)
    ? profile.preferred_training_days.map((day) => String(day).toLowerCase())
    : []

  let days = plan.days.map((day) => {
    const sport = normalizeSportKey(day.sport) as PlanSport
    const sportLabel = findCustomSportLabel(day.sport_label, custom)
    const normalizedDay: PlanDay = {
      ...day,
      sport: KNOWN_PLAN_SPORTS.has(sport) ? sport : 'other',
      sport_label:
        sport === 'other' || !KNOWN_PLAN_SPORTS.has(sport)
          ? sportLabel || day.sport_label?.trim() || undefined
          : undefined,
    }
    if (
      normalizedDay.session_type === 'rest' &&
      (normalizedDay.total_duration_minutes !== 0 || normalizedDay.sport !== 'other' || normalizedDay.sport_label)
    ) {
      repairs.push(`rest_normalized:${normalizedDay.date}`)
      return toRestDay({ ...normalizedDay, sport: 'other', sport_label: undefined }, day.description, locale)
    }
    if (normalizedDay.session_type !== 'rest' && !isAllowedTrainingSport(normalizedDay, known, custom)) {
      repairs.push(`sport_whitelist:${normalizedDay.date}:${normalizedDay.sport_label || normalizedDay.sport}`)
      const reason =
        locale === 'de'
          ? 'In einen Ruhetag umgewandelt: Sportart ist nicht in den verfügbaren Sportarten.'
          : 'Converted to rest: sport not in available_sports whitelist.'
      return toRestDay(normalizedDay, reason, locale)
    }
    const dayLimit = budget.max_training_minutes_per_day[day.day]
    return clampDayToLimit(normalizedDay, dayLimit)
  })

  const qualityIndexes = days.map((day, index) => (isQualitySession(day) ? index : -1)).filter((index) => index >= 0)
  if (qualityIndexes.length > budget.max_quality_sessions) {
    for (const index of qualityIndexes.slice(budget.max_quality_sessions)) {
      days[index] = softenQuality(days[index])
      repairs.push(`quality_softened:${days[index].date}`)
    }
  }

  // After count clamp, avoid back-to-back hard days by softening the later session.
  const remainingQuality = days
    .map((day, index) => (isQualitySession(day) ? index : -1))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)
  for (let i = 1; i < remainingQuality.length; i += 1) {
    const prev = remainingQuality[i - 1]
    const curr = remainingQuality[i]
    const prevDate = Date.parse(`${days[prev].date}T00:00:00Z`)
    const currDate = Date.parse(`${days[curr].date}T00:00:00Z`)
    if (!Number.isFinite(prevDate) || !Number.isFinite(currDate)) continue
    const dayGap = Math.round((currDate - prevDate) / 86_400_000)
    if (dayGap <= 1) {
      days[curr] = softenQuality(days[curr])
      repairs.push(`quality_adjacent_softened:${days[curr].date}`)
    }
  }

  const runningIndexes = days
    .map((day, index) => (day.session_type === 'training' && day.sport === 'running' ? index : -1))
    .filter((index) => index >= 0)
    .sort((a, b) => days[b].total_duration_minutes - days[a].total_duration_minutes)
  if (runningIndexes.length && days[runningIndexes[0]].total_duration_minutes > budget.max_long_run_minutes) {
    const index = runningIndexes[0]
    days[index] = scaleStepsToDuration(days[index], budget.max_long_run_minutes)
    repairs.push(`long_clamped:${days[index].date}:${budget.max_long_run_minutes}`)
  }

  const enduranceIndexes = days
    .map((day, index) => (day.session_type === 'training' && ENDURANCE_SPORTS.has(day.sport) ? index : -1))
    .filter((index) => index >= 0)
    .sort((a, b) => days[a].total_duration_minutes - days[b].total_duration_minutes)
  while (enduranceIndexes.length > budget.max_endurance_sessions) {
    const index = enduranceIndexes.shift()
    if (index === undefined) break
    const reason =
      locale === 'de'
        ? 'In einen Ruhetag umgewandelt: maximale Anzahl an Ausdauereinheiten erreicht.'
        : 'Converted to rest: endurance session frequency cap reached.'
    days[index] = toRestDay(days[index], reason, locale)
    repairs.push(`endurance_frequency:${days[index].date}`)
  }

  const strengthIndexes = days
    .map((day, index) => (day.session_type === 'training' && day.sport === 'strength' ? index : -1))
    .filter((index) => index >= 0)
    .sort((a, b) => days[a].total_duration_minutes - days[b].total_duration_minutes)
  while (strengthIndexes.length > budget.max_strength_sessions) {
    const index = strengthIndexes.shift()
    if (index === undefined) break
    const reason =
      locale === 'de'
        ? 'In einen Ruhetag umgewandelt: maximale Anzahl an Krafteinheiten erreicht.'
        : 'Converted to rest: strength session frequency cap reached.'
    days[index] = toRestDay(days[index], reason, locale)
    repairs.push(`strength_frequency:${days[index].date}`)
  }

  for (let index = 0; index < days.length; index += 1) {
    const current = days[index]
    if (current.session_type !== 'training' || current.sport !== 'strength') continue
    if (
      budget.max_strength_minutes_per_session > 0 &&
      current.total_duration_minutes > budget.max_strength_minutes_per_session
    ) {
      days[index] = scaleStepsToDuration(current, budget.max_strength_minutes_per_session)
      repairs.push(`strength_session_clamped:${current.date}:${budget.max_strength_minutes_per_session}`)
    }
  }

  const strengthTotal = () =>
    days.reduce(
      (sum, day) =>
        day.session_type === 'training' && day.sport === 'strength' ? sum + day.total_duration_minutes : sum,
      0,
    )
  while (budget.max_strength_minutes_total > 0 && strengthTotal() > budget.max_strength_minutes_total) {
    const candidates = days
      .map((day, index) => ({ day, index }))
      .filter(
        ({ day }) => day.session_type === 'training' && day.sport === 'strength' && day.total_duration_minutes > 20,
      )
      .sort((a, b) => b.day.total_duration_minutes - a.day.total_duration_minutes)
    if (candidates.length) {
      const target = candidates[0]
      const overflow = strengthTotal() - budget.max_strength_minutes_total
      const nextDuration = Math.max(20, target.day.total_duration_minutes - Math.max(5, overflow))
      if (nextDuration < target.day.total_duration_minutes) {
        days[target.index] = scaleStepsToDuration(target.day, nextDuration)
        repairs.push(`strength_total_clamped:${target.day.date}:${nextDuration}`)
        continue
      }
    }
    const dropCandidates = days
      .map((day, index) => ({ day, index }))
      .filter(({ day }) => day.session_type === 'training' && day.sport === 'strength')
      .sort((a, b) => a.day.total_duration_minutes - b.day.total_duration_minutes)
    if (!dropCandidates.length) break
    const drop = dropCandidates[0]
    const reason =
      locale === 'de'
        ? 'In einen Ruhetag umgewandelt: maximales Krafttrainingsvolumen erreicht.'
        : 'Converted to rest: strength minutes cap reached.'
    days[drop.index] = toRestDay(drop.day, reason, locale)
    repairs.push(`strength_total_drop:${drop.day.date}`)
  }

  const enduranceTotal = () =>
    days.reduce(
      (sum, day) =>
        day.session_type === 'training' && ENDURANCE_SPORTS.has(day.sport) ? sum + day.total_duration_minutes : sum,
      0,
    )
  while (enduranceTotal() > budget.max_total_training_minutes) {
    const candidates = days
      .map((day, index) => ({ day, index }))
      .filter(
        ({ day }) =>
          day.session_type === 'training' && ENDURANCE_SPORTS.has(day.sport) && day.total_duration_minutes > 15,
      )
      .sort((a, b) => b.day.total_duration_minutes - a.day.total_duration_minutes)
    if (candidates.length) {
      const target = candidates[0]
      // Prefer trimming supporting runs before the designated long.
      const longIndex = days
        .map((day, index) => (day.session_type === 'training' && day.sport === 'running' ? index : -1))
        .filter((index) => index >= 0)
        .sort((a, b) => days[b].total_duration_minutes - days[a].total_duration_minutes)[0]
      const trimTarget = candidates.find((item) => item.index !== longIndex) || candidates[0]
      const overflow = enduranceTotal() - budget.max_total_training_minutes
      const floor =
        trimTarget.index === longIndex
          ? Math.min(budget.max_long_run_minutes, Math.max(15, budget.max_long_run_minutes - 5))
          : 15
      const nextDuration = Math.max(floor, trimTarget.day.total_duration_minutes - Math.max(5, overflow))
      if (nextDuration < trimTarget.day.total_duration_minutes) {
        days[trimTarget.index] = scaleStepsToDuration(trimTarget.day, nextDuration)
        repairs.push(`total_clamped:${trimTarget.day.date}:${nextDuration}`)
        continue
      }
    }
    const dropCandidates = days
      .map((day, index) => ({ day, index }))
      .filter(({ day }) => day.session_type === 'training' && ENDURANCE_SPORTS.has(day.sport))
      .sort((a, b) => a.day.total_duration_minutes - b.day.total_duration_minutes)
    if (!dropCandidates.length) break
    const drop = dropCandidates[0]
    const reason =
      locale === 'de'
        ? 'In einen Ruhetag umgewandelt: maximales Ausdauertrainingsvolumen erreicht.'
        : 'Converted to rest: endurance minutes cap reached.'
    days[drop.index] = toRestDay(drop.day, reason, locale)
    repairs.push(`total_drop:${drop.day.date}`)
  }

  const totalTrainingIndexes = () =>
    days.map((day, index) => ({ day, index })).filter(({ day }) => day.session_type === 'training')
  while (totalTrainingIndexes().length > budget.max_training_sessions) {
    const drop = totalTrainingIndexes().sort((a, b) => {
      const aOutside = preferred.length && !preferred.includes(a.day.day) ? 1 : 0
      const bOutside = preferred.length && !preferred.includes(b.day.day) ? 1 : 0
      return bOutside - aOutside || a.day.total_duration_minutes - b.day.total_duration_minutes
    })[0]
    if (!drop) break
    const reason =
      locale === 'de'
        ? 'In einen Ruhetag umgewandelt: maximale Anzahl an Trainingseinheiten erreicht.'
        : 'Converted to rest: total training session cap reached.'
    days[drop.index] = toRestDay(drop.day, reason, locale)
    repairs.push(`training_frequency:${drop.day.date}`)
  }

  if (preferred.length) {
    const trainingDays = days.filter((day) => day.session_type === 'training')
    const outside = trainingDays.filter((day) => !preferred.includes(day.day))
    if (trainingDays.length && outside.length === trainingDays.length) {
      repairs.push('prefs_all_outside_preferred_days')
    }
  }

  return { plan: { ...plan, days }, repairs }
}
