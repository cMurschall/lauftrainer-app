import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { addDaysToDateKey, assertRollingPlan, describeGeminiFailure, normalizePlan, weekdayFromDateKey } from '../src/training.ts'

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

describe('describeGeminiFailure', () => {
  const rateLimited = (details: unknown[]) => ({
    error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for quota metric', details },
  })

  it('passes a rate limit through as 429 instead of masking it as a gateway error', () => {
    const failure = describeGeminiFailure(429, rateLimited([]))
    assert.equal(failure.clientStatus, 429)
    assert.match(failure.detail, /erneut versuchen/)
    assert.equal(failure.retryAfterSeconds, undefined)
  })

  it('never leaks the provider or our billing state to the client', () => {
    const detailsToCheck = [
      describeGeminiFailure(429, {
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: 'Your prepayment credits are depleted. Please go to AI Studio to manage billing.',
        },
      }).detail,
      describeGeminiFailure(429, rateLimited([])).detail,
      describeGeminiFailure(503, { error: { status: 'UNAVAILABLE' } }).detail,
      describeGeminiFailure(404, { error: { status: 'NOT_FOUND' } }).detail,
    ]
    for (const detail of detailsToCheck) {
      assert.doesNotMatch(detail, /gemini|google|prepaid|guthaben.*aufgebraucht|credit|quota/i)
    }
  })

  it('keeps the depleted-prepaid cause in the log while staying neutral to the user', () => {
    const failure = describeGeminiFailure(429, {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'Your prepayment credits are depleted. Please go to AI Studio to manage billing.',
      },
    })
    assert.equal(failure.clientStatus, 429)
    assert.match(failure.detail, /nicht verfügbar/)
    assert.match(failure.logLine, /prepayment credits are depleted/i)
  })

  it('offers the wait time when Google sends a short RetryInfo', () => {
    const failure = describeGeminiFailure(
      429,
      rateLimited([{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '27s' }]),
    )
    assert.equal(failure.retryAfterSeconds, 27)
    assert.match(failure.detail, /27 Sekunden/)
  })

  it('logs the quota id and Google message for diagnosis', () => {
    const failure = describeGeminiFailure(
      429,
      rateLimited([{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }]),
    )
    assert.match(failure.logLine, /RESOURCE_EXHAUSTED/)
    assert.match(failure.logLine, /GenerateRequestsPerDayPerProjectPerModel-FreeTier/)
    assert.match(failure.logLine, /Quota exceeded/)
  })

  it('maps an overloaded model to 503 and anything else to 502', () => {
    assert.equal(describeGeminiFailure(503, { error: { status: 'UNAVAILABLE' } }).clientStatus, 503)
    assert.equal(describeGeminiFailure(404, { error: { status: 'NOT_FOUND' } }).clientStatus, 502)
  })

  it('survives a non-JSON error body', () => {
    const failure = describeGeminiFailure(429, '<html>rate limited</html>')
    assert.equal(failure.clientStatus, 429)
    assert.match(failure.logLine, /Gemini 429/)
  })
})
