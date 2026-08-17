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

function parseChartDate(value: string): Date | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const date = new Date(match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : value)
  return Number.isFinite(date.getTime()) ? date : undefined
}

export function formatChartDate(value: string, locale = 'de-DE', options?: { includeYear?: boolean }): string {
  const date = parseChartDate(value)
  if (!date) return '–'
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const week = isoWeekNumber(date)
  const dayMonth = options?.includeYear ? `${day}.${month}.${date.getUTCFullYear()}` : `${day}.${month}.`
  return locale.toLowerCase().startsWith('de') ? `KW ${week} · ${dayMonth}` : `W${week} · ${dayMonth}`
}

/** Compact age relative to a reference day, e.g. "−4 Wo", "−3 Mon", "−1,5 J". */
export function formatRelativeChartDate(value: string, reference: string, locale = 'de-DE'): string {
  const date = parseChartDate(value)
  const ref = parseChartDate(reference)
  if (!date || !ref) return '–'
  const days = Math.round((ref.getTime() - date.getTime()) / 86400000)
  const de = locale.toLowerCase().startsWith('de')
  if (days <= 0) return de ? 'jetzt' : 'now'
  if (days < 7) return de ? `−${days} T` : `−${days}d`
  if (days < 60) {
    const weeks = Math.max(1, Math.round(days / 7))
    return de ? `−${weeks} Wo` : `−${weeks}w`
  }
  if (days < 365) {
    const months = Math.max(1, Math.round(days / 30.4375))
    return de ? `−${months} Mon` : `−${months}mo`
  }
  const years = Math.round((days / 365.25) * 2) / 2
  const text = Number.isInteger(years) ? String(years) : de ? years.toFixed(1).replace('.', ',') : years.toFixed(1)
  return de ? `−${text} J` : `−${text}y`
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
