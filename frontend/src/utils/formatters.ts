/** Accepts ISO timestamps as well as the DD-MM-YYYY shape produced by some CSV imports. */
function parseWorkoutDate(value: string): Date | undefined {
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  const date = new Date(match ? `${match[3]}-${match[2]}-${match[1]}` : value)
  return Number.isFinite(date.getTime()) ? date : undefined
}

export function formatWorkoutDate(value: string, locale = 'de-DE'): string {
  const date = parseWorkoutDate(value)
  if (!date) return '–'
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(',', ' ·')
}

function isoWeekNumber(date: Date): number {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function formatChartDate(value: string, locale = 'de-DE'): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const date = new Date(match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : value)
  if (!Number.isFinite(date.getTime())) return '–'
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const week = isoWeekNumber(date)
  return locale.toLowerCase().startsWith('de') ? `KW ${week} · ${day}.${month}.` : `W${week} · ${day}.${month}.`
}

export function formatWeekLabel(value: string, locale = 'de-DE'): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const date = new Date(match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : value)
  if (!Number.isFinite(date.getTime())) return 'Woche ab –'
  return `Woche ab ${new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date)}`
}

/** Compact activity list label, e.g. "Mi., 12. Aug.". */
export function formatActivityDate(value: string, locale = 'de-DE'): string {
  const date = parseWorkoutDate(value)
  if (!date) return '–'
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)
}

/** Short week-start label without the year, e.g. "10. Aug.". */
export function formatWeekStartShort(value: string, locale = 'de-DE'): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const date = new Date(match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : value)
  if (!Number.isFinite(date.getTime())) return '–'
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date)
}

/** Training time as "45 min" below an hour, otherwise "1:20 h". */
export function formatTrainingMinutes(minutes: number | undefined): string {
  if (!Number.isFinite(minutes) || (minutes || 0) < 0) return '–'
  const total = Math.round(minutes || 0)
  if (total < 60) return `${total} min`
  const rest = total % 60
  return rest ? `${Math.floor(total / 60)}:${String(rest).padStart(2, '0')} h` : `${total / 60} h`
}

export function formatWorkoutDuration(seconds: number | undefined): string {
  return Number.isFinite(seconds) && (seconds || 0) >= 0 ? `${Math.round((seconds || 0) / 60)} min` : '–'
}

export function formatWorkoutDistance(distanceKm: number | undefined): string {
  return Number.isFinite(distanceKm) && (distanceKm || 0) >= 0 ? `${(distanceKm || 0).toFixed(1)} km` : '–'
}

export function formatSport(value: string | undefined): string {
  const sport = (value || '').trim().toLowerCase()
  if (['running', 'run', 'laufen'].includes(sport)) return 'Laufen'
  if (['cycling', 'cycle', 'biking', 'radfahren'].includes(sport)) return 'Radfahren'
  if (!sport) return 'Training'
  return sport.charAt(0).toUpperCase() + sport.slice(1)
}
