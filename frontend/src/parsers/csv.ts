import type { Workout } from '../types/workout'

const number = (value?: string) => {
  if (!value?.trim()) return undefined
  const result = Number(value.replace(',', '.').trim())
  return Number.isFinite(result) ? result : undefined
}

const seconds = (value?: string) => {
  const parts = (value || '').split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return parts[0] * 60 + (parts[1] || 0)
}

function parseRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const values: string[] = []
      let value = '',
        quoted = false
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index]
        if (char === '"') {
          if (quoted && line[index + 1] === '"') {
            value += '"'
            index += 1
          } else quoted = !quoted
        } else if (char === ',' && !quoted) {
          values.push(value)
          value = ''
        } else value += char
      }
      values.push(value)
      return values
    })
}

function findIndex(headers: string[], names: string[]): number {
  return names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1
}

export function parsePolarCsv(text: string, fileName: string): Workout {
  const rows = parseRows(text)
  if (rows.length < 2) throw new Error(`${fileName}: CSV enthält keine Zusammenfassung.`)
  const headers = rows[0].map((value) => value.trim())
  const values = rows[1]
  const get = (header: string) => values[headers.indexOf(header)]
  const date = get('Date')
  const durationSeconds = seconds(get('Duration'))
  if (!date || !durationSeconds) throw new Error(`${fileName}: Datum oder Dauer fehlt.`)
  const detailRows = rows.length > 2 && rows[2].includes('Time') ? rows.slice(3) : []
  const detailHeaders = rows.length > 2 ? rows[2].map((value) => value.trim()) : []
  const detailIndex = (names: string[]) => findIndex(detailHeaders, names)
  const records = detailRows
    .map((row) => {
      const elapsed = row[detailIndex(['Time'])] || '00:00:00'
      const elapsedParts = elapsed.split(':').map(Number)
      const elapsedSeconds =
        elapsedParts.length === 3 ? elapsedParts[0] * 3600 + elapsedParts[1] * 60 + elapsedParts[2] : 0
      return {
        elapsedSeconds,
        heartRateBpm: number(row[detailIndex(['HR (bpm)'])]),
        speedKmh: number(row[detailIndex(['Speed (km/h)'])]),
        altitudeM: number(row[detailIndex(['Altitude (m)'])]),
        distanceM: number(row[detailIndex(['Distances (m)', 'Distance (m)'])]),
        powerW: number(row[detailIndex(['Power (W)'])]),
      }
    })
    .filter((record) => record.elapsedSeconds > 0 || record.heartRateBpm !== undefined)
  return {
    id: `csv-${fileName}-${date}-${durationSeconds}`,
    source: 'polar-csv',
    name: get('Name') || fileName,
    sport: get('Sport') || 'RUNNING',
    rawSport: get('Sport') || 'RUNNING',
    date,
    durationSeconds,
    distanceKm: number(get('Total distance (km)')),
    averageHeartRate: number(get('Average heart rate (bpm)')),
    calories: number(get('Calories')),
    ascentM: number(get('Ascent (m)')),
    records,
    importedAt: new Date().toISOString(),
    elevationGainM: number(get('Ascent (m)')),
  }
}
