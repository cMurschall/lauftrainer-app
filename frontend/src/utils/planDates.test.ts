import { describe, expect, it } from 'vitest'
import { addDaysToDateKey, localDateKey, planHasDatedDays, weekdayFromDateKey } from './planDates'

describe('planDates helpers', () => {
  it('derives weekday and consecutive dates', () => {
    expect(weekdayFromDateKey('2026-08-14')).toBe('friday')
    expect(addDaysToDateKey('2026-08-14', 3)).toBe('2026-08-17')
    expect(planHasDatedDays([{ date: '2026-08-14' }, { date: '2026-08-15' }])).toBe(true)
    expect(planHasDatedDays([{ date: '' }])).toBe(false)
    expect(localDateKey(new Date(2026, 7, 14))).toBe('2026-08-14')
  })
})
