import { describe, expect, it } from 'vitest'
import { formatChartDate } from './formatters'

describe('formatChartDate', () => {
  it('puts calendar week first without year', () => {
    expect(formatChartDate('2026-07-06', 'de-DE')).toBe('KW 28 · 06.07.')
    expect(formatChartDate('2026-07-06', 'en-US')).toBe('W28 · 06.07.')
  })
})
