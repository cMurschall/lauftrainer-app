import { SPORT_CATEGORIES, type SportCategory } from '../types/workout'

export type WeeklyChartMetric = 'minutes' | 'distance'

export interface WeeklySportsWeek {
  sports: Partial<Record<SportCategory, { minutes: number; distanceKm: number; workoutCount: number }>>
}

export interface WeeklySportSeries {
  sport: SportCategory
  values: number[]
  color: string
}

/** Reserved for the aggregated total series, so no sport shares it. */
const TOTAL_COLOR = 'var(--accent)'

const PREFERRED_COLORS: Record<SportCategory, string> = {
  Running: 'var(--chart-blue)',
  Cycling: 'var(--chart-gold)',
  Swimming: 'var(--chart-purple)',
  Hiking: 'var(--chart-rose)',
  Walking: 'var(--muted)',
  Climbing: 'var(--chart-rose)',
  Triathlon: 'var(--chart-purple)',
  Other: 'var(--muted)',
}

const FALLBACK_COLORS = [
  'var(--chart-blue)',
  'var(--chart-gold)',
  'var(--chart-purple)',
  'var(--chart-rose)',
  'var(--muted)',
  'var(--text)',
]

function sportValue(week: WeeklySportsWeek, sport: SportCategory, metric: WeeklyChartMetric): number {
  const entry = week.sports?.[sport]
  const value = metric === 'minutes' ? entry?.minutes : entry?.distanceKm
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : 0
}

/** Sports that actually contributed to the selected metric inside the shown range. */
export function activeWeeklySports(weeks: WeeklySportsWeek[], metric: WeeklyChartMetric): SportCategory[] {
  return SPORT_CATEGORIES.filter((sport) => weeks.some((week) => sportValue(week, sport, metric) > 0))
}

/**
 * One series per sport with data – sports without values are dropped entirely instead of
 * drawing flat zero lines (a runner should never see a cycling series).
 */
export function weeklySportSeries(weeks: WeeklySportsWeek[], metric: WeeklyChartMetric): WeeklySportSeries[] {
  const used = new Set<string>([TOTAL_COLOR])
  return activeWeeklySports(weeks, metric).map((sport) => {
    const preferred = PREFERRED_COLORS[sport]
    const color = used.has(preferred) ? (FALLBACK_COLORS.find((item) => !used.has(item)) || preferred) : preferred
    used.add(color)
    return { sport, values: weeks.map((week) => sportValue(week, sport, metric)), color }
  })
}

/** A total only adds information once more than one sport is in play. */
export function showsWeeklyTotal(series: WeeklySportSeries[]): boolean {
  return series.length > 1
}

export const WEEKLY_TOTAL_COLOR = TOTAL_COLOR
