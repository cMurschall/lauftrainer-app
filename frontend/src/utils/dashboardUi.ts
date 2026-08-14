export function isTrainingPlanLocalMode(mode = import.meta.env.VITE_TRAINING_PLAN_MODE): boolean {
  return ['mock', 'local'].includes(String(mode || ''))
}

export function canCreatePlan(input: {
  consent: boolean
  workoutCount: number
  loading: boolean
  credits: number
  localMode: boolean
}): boolean {
  if (input.loading || !input.consent || input.workoutCount < 1) return false
  if (!input.localMode && input.credits < 1) return false
  return true
}

export type ConnectorBannerKind = 'sync' | 'empty' | 'localData'

export function connectorBannerKind(input: {
  hasWorkouts: boolean
  hasActiveConnected: boolean
}): ConnectorBannerKind {
  if (input.hasActiveConnected) return 'sync'
  if (input.hasWorkouts) return 'localData'
  return 'empty'
}

/** Polar→Strava users who sync both connectors risk double-counting workouts. */
export function shouldWarnPolarStravaOverlap(
  connectors: Array<{ id: string; connected: boolean; active: boolean }>,
): boolean {
  const polar = connectors.find((item) => item.id === 'polar')
  const strava = connectors.find((item) => item.id === 'strava')
  return Boolean(polar?.connected && polar.active && strava?.connected && strava.active)
}

export type CreatePlanButtonMode = 'create' | 'replace'

export function createPlanButtonMode(input: { hasPlan: boolean }): CreatePlanButtonMode {
  return input.hasPlan ? 'replace' : 'create'
}

export type SportKind = 'running' | 'cycling' | 'swimming' | 'hiking' | 'walking' | 'other'

/** Maps free-text sport names from imports/connectors onto the dashboard accent colors. */
export function sportKind(sport: string | undefined): SportKind {
  const value = (sport || '').toLowerCase()
  if (value.includes('cycl') || value.includes('rad') || value.includes('bike')) return 'cycling'
  if (value.includes('swim') || value.includes('schwimm')) return 'swimming'
  if (value.includes('hike') || value.includes('wand')) return 'hiking'
  if (value.includes('walk') || value.includes('geh')) return 'walking'
  if (value.includes('run') || value.includes('lauf')) return 'running'
  return 'other'
}

interface WeeklyInput {
  weekStart: string
  workoutCount: number
  distanceKm: number
  durationMinutes: number
}

export interface WeeklyTrendEntry {
  weekStart: string
  workoutCount: number
  distanceKm: number
  durationMinutes: number
  isCurrentWeek: boolean
  /** Bar width in percent, scaled against the highest training time in the shown range. */
  sharePercent: number
}

function safeNumber(value: number | undefined): number {
  return Number.isFinite(value) && (value || 0) > 0 ? (value as number) : 0
}

/**
 * Newest-first trend rows on a shared training-time scale. The current week is always
 * included so an untrained week reads as "0 min" instead of silently disappearing.
 */
export function weeklyTrend(input: {
  weekly: WeeklyInput[]
  currentWeekStart: string
  limit?: number
}): WeeklyTrendEntry[] {
  const hasCurrent = input.weekly.some((week) => week.weekStart === input.currentWeekStart)
  const weeks = hasCurrent
    ? input.weekly
    : [
        ...input.weekly,
        { weekStart: input.currentWeekStart, workoutCount: 0, distanceKm: 0, durationMinutes: 0 },
      ]
  const recent = weeks.slice(-(input.limit ?? 6))
  const peakMinutes = Math.max(...recent.map((week) => safeNumber(week.durationMinutes)), 0)
  return recent
    .map((week) => {
      const durationMinutes = safeNumber(week.durationMinutes)
      return {
        weekStart: week.weekStart,
        workoutCount: safeNumber(week.workoutCount),
        distanceKm: safeNumber(week.distanceKm),
        durationMinutes,
        isCurrentWeek: week.weekStart === input.currentWeekStart,
        sharePercent: peakMinutes > 0 ? Math.round((durationMinutes / peakMinutes) * 100) : 0,
      }
    })
    .reverse()
}

/** Average training minutes across completed weeks, ignoring the in-progress current week. */
export function averageWeeklyMinutes(input: {
  weekly: Array<Pick<WeeklyInput, 'weekStart' | 'durationMinutes'>>
  currentWeekStart: string
  weeks?: number
}): number {
  const completed = input.weekly
    .filter((week) => week.weekStart !== input.currentWeekStart)
    .slice(-(input.weeks ?? 4))
  if (!completed.length) return 0
  const total = completed.reduce((sum, week) => sum + safeNumber(week.durationMinutes), 0)
  return Math.round(total / completed.length)
}
