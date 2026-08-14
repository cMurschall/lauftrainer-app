import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { addDaysToDateKey, assertRollingPlan, normalizePlan, weekdayFromDateKey } from '../src/training.ts'

describe('rolling training plan validation', () => {
  it('maps weekdays and consecutive dates from the start date', () => {
    assert.equal(weekdayFromDateKey('2026-08-14'), 'friday')
    assert.equal(addDaysToDateKey('2026-08-14', 1), '2026-08-15')
    assert.equal(weekdayFromDateKey(addDaysToDateKey('2026-08-14', 2)), 'sunday')
  })

  it('fills empty workout_steps on rest days before schema validation', () => {
    const normalized = normalizePlan({
      week_summary: { focus_title: 'Base', goal_description: 'Rebuild' },
      days: [{
        date: '2026-08-15',
        day: 'saturday',
        sport: 'other',
        session_type: 'rest',
        title: 'Rest',
        description: 'Recovery day',
        target_focus: 'Recovery',
        total_duration_minutes: 0,
        workout_steps: [],
      }],
    }) as { days: Array<{ workout_steps: unknown[] }> }
    assert.equal(normalized.days[0].workout_steps.length, 1)
  })

  it('accepts a dated 7-day window and rejects gaps', () => {
    const start = '2026-08-14'
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = addDaysToDateKey(start, index)
      return {
        date,
        day: weekdayFromDateKey(date),
        sport: 'running' as const,
        session_type: 'training' as const,
        title: 'Easy',
        description: 'Easy run',
        target_focus: 'Base',
        total_duration_minutes: 30,
        workout_steps: [{ step_duration: '30 min', step_intensity: 'easy', step_instruction: 'Run easy' }],
      }
    })
    const plan = assertRollingPlan({
      week_summary: { focus_title: 'Base', goal_description: 'Rebuild' },
      days,
    }, start)
    assert.equal(plan.start_date, start)
    assert.equal(plan.days[0].date, start)
    assert.equal(plan.days[6].date, '2026-08-20')

    assert.throws(() => assertRollingPlan({
      week_summary: { focus_title: 'Base', goal_description: 'Rebuild' },
      days: days.map((day, index) => index === 3 ? { ...day, date: '2026-08-19', day: 'wednesday' } : day),
    }, start))
  })
})
