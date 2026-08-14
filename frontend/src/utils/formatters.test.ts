import { describe, expect, it } from 'vitest'
import { formatChartDate, formatRelativeChartDate } from './formatters'

describe('formatChartDate', () => {
  it('puts calendar week first without year', () => {
    expect(formatChartDate('2026-07-06', 'de-DE')).toBe('KW 28 · 06.07.')
    expect(formatChartDate('2026-07-06', 'en-US')).toBe('W28 · 06.07.')
  })

  it('can include the year for long-range tooltips', () => {
    expect(formatChartDate('2024-08-12', 'de-DE', { includeYear: true })).toBe('KW 33 · 12.08.2024')
    expect(formatChartDate('2024-08-12', 'en-US', { includeYear: true })).toBe('W33 · 12.08.2024')
  })
})

describe('formatRelativeChartDate', () => {
  const ref = '2026-08-14'

  it('formats compact German ages', () => {
    expect(formatRelativeChartDate('2026-08-14', ref, 'de-DE')).toBe('jetzt')
    expect(formatRelativeChartDate('2026-08-11', ref, 'de-DE')).toBe('−3 T')
    expect(formatRelativeChartDate('2026-07-17', ref, 'de-DE')).toBe('−4 Wo')
    expect(formatRelativeChartDate('2026-05-14', ref, 'de-DE')).toBe('−3 Mon')
    expect(formatRelativeChartDate('2025-02-14', ref, 'de-DE')).toBe('−1,5 J')
    expect(formatRelativeChartDate('2024-08-14', ref, 'de-DE')).toBe('−2 J')
  })

  it('formats compact English ages', () => {
    expect(formatRelativeChartDate('2026-08-14', ref, 'en-US')).toBe('now')
    expect(formatRelativeChartDate('2026-08-11', ref, 'en-US')).toBe('−3d')
    expect(formatRelativeChartDate('2026-07-17', ref, 'en-US')).toBe('−4w')
    expect(formatRelativeChartDate('2026-05-14', ref, 'en-US')).toBe('−3mo')
    expect(formatRelativeChartDate('2025-02-14', ref, 'en-US')).toBe('−1.5y')
  })
})
