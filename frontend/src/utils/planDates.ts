import type { WeekDay } from '../types/workout'

const WEEKDAYS: WeekDay[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function weekdayFromDateKey(dateKey: string): WeekDay {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return WEEKDAYS[date.getDay()]
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day + days)
  return localDateKey(date)
}

export function planHasDatedDays(days: Array<{ date?: string }>): boolean {
  return days.length > 0 && days.every((day) => typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date))
}
