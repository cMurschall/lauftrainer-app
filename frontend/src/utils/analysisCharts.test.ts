import { describe, expect, it } from 'vitest'
import { activeWeeklySports, showsWeeklyTotal, weeklySportSeries } from './analysisCharts'

const week = (sports: Record<string, { minutes: number; distanceKm: number }>) => ({
  sports: Object.fromEntries(
    Object.entries(sports).map(([sport, value]) => [sport, { ...value, workoutCount: 1 }]),
  ),
})

describe('weekly chart series', () => {
  it('drops sports without data for the selected metric', () => {
    const weeks = [week({ Running: { minutes: 40, distanceKm: 8 } }), week({ Running: { minutes: 0, distanceKm: 0 } })]
    expect(activeWeeklySports(weeks, 'minutes')).toEqual(['Running'])
    expect(weeklySportSeries(weeks, 'minutes').map((item) => item.sport)).toEqual(['Running'])
  })

  it('keeps a sport for minutes but not for distance when no distance was tracked', () => {
    const weeks = [week({ Swimming: { minutes: 45, distanceKm: 0 } })]
    expect(activeWeeklySports(weeks, 'minutes')).toEqual(['Swimming'])
    expect(activeWeeklySports(weeks, 'distance')).toEqual([])
  })

  it('returns one series per sport with data, in category order', () => {
    const weeks = [
      week({ Running: { minutes: 30, distanceKm: 6 }, Hiking: { minutes: 90, distanceKm: 9 } }),
      week({ Cycling: { minutes: 120, distanceKm: 45 } }),
    ]
    const series = weeklySportSeries(weeks, 'minutes')
    expect(series.map((item) => item.sport)).toEqual(['Running', 'Cycling', 'Hiking'])
    expect(series[0].values).toEqual([30, 0])
    expect(series[1].values).toEqual([0, 120])
  })

  it('assigns distinct colors and never reuses the total color', () => {
    const weeks = [
      week({
        Running: { minutes: 30, distanceKm: 6 },
        Cycling: { minutes: 60, distanceKm: 20 },
        Hiking: { minutes: 90, distanceKm: 9 },
        Climbing: { minutes: 45, distanceKm: 0 },
      }),
    ]
    const colors = weeklySportSeries(weeks, 'minutes').map((item) => item.color)
    expect(new Set(colors).size).toBe(colors.length)
    expect(colors).not.toContain('var(--accent)')
  })

  it('only adds a total series when more than one sport is shown', () => {
    expect(showsWeeklyTotal(weeklySportSeries([week({ Running: { minutes: 30, distanceKm: 6 } })], 'minutes'))).toBe(
      false,
    )
    expect(
      showsWeeklyTotal(
        weeklySportSeries(
          [week({ Running: { minutes: 30, distanceKm: 6 }, Cycling: { minutes: 60, distanceKm: 20 } })],
          'minutes',
        ),
      ),
    ).toBe(true)
  })

  it('ignores non-finite values', () => {
    const weeks = [{ sports: { Running: { minutes: Number.NaN, distanceKm: Number.NaN, workoutCount: 1 } } }]
    expect(weeklySportSeries(weeks, 'minutes')).toEqual([])
  })
})
