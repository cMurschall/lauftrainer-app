export function formatWorkoutDate(value: string, locale = 'de-DE'): string {
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  const normalized = match ? `${match[3]}-${match[2]}-${match[1]}` : value
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime())) return '–'
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

export function formatChartDate(value: string, locale = 'de-DE'): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const date = new Date(match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : value)
  if (!Number.isFinite(date.getTime())) return '–'
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export function formatWeekLabel(value: string, locale = 'de-DE'): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const date = new Date(match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : value)
  if (!Number.isFinite(date.getTime())) return 'Woche ab –'
  return `Woche ab ${new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date)}`
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
