import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeLoadBudget,
  isQualitySession,
  reviewAndClampPlan,
  sanitizePlanInputs,
  type PlanDay,
  type TrainingPlanLike,
} from '../src/planSafety.ts'

function day(partial: Partial<PlanDay> & Pick<PlanDay, 'date' | 'day' | 'sport' | 'total_duration_minutes'>): PlanDay {
  return {
    session_type: partial.session_type || (partial.total_duration_minutes ? 'training' : 'rest'),
    title: partial.title || 'Session',
    description: partial.description || 'Session',
    target_focus: partial.target_focus || 'Focus',
    workout_steps: partial.workout_steps || [{
      step_duration: `${partial.total_duration_minutes || 0} min`,
      step_intensity: partial.target_focus?.includes('interval') ? 'intervals' : 'easy',
      step_instruction: partial.description || 'Do the session',
    }],
    ...partial,
  }
}

function planFromDays(days: PlanDay[]): TrainingPlanLike {
  return {
    start_date: days[0]?.date,
    week_summary: { focus_title: 'Test', goal_description: 'Test' },
    days,
  }
}

describe('sanitizePlanInputs', () => {
  it('marks short segments low-confidence and ignores them for longest reliable run', () => {
    const sanitized = sanitizePlanInputs({
      metrics: {
        weekly: [
          { week_start: '2026-07-20', total_minutes: 21 },
          { week_start: '2026-07-27', total_minutes: 13.5 },
          { week_start: '2026-08-03', total_minutes: 20.9 },
          { week_start: '2026-08-10', total_minutes: 7.9 },
        ],
      },
      recent_workouts: [
        { sport: 'RUNNING', duration_minutes: 8, distance_km: 1, elevation_gain_m: 266 },
        { sport: 'RUNNING', duration_minutes: 79, distance_km: 10.5, avg_hr: 139, elevation_gain_m: 9 },
        { sport: 'RUNNING', duration_minutes: 7, distance_km: 1, avg_hr: 150, elevation_gain_m: 200 },
      ],
      profile: { hr_zones: { z2: [107, 124] } },
    })
    assert.equal(sanitized.best_recent_week_minutes, 21)
    assert.equal(sanitized.longest_reliable_run_minutes, 79)
    assert.equal(sanitized.signals.short_segment_count, 2)
    assert.equal(sanitized.signals.elevation_outlier_count, 2)
    assert.equal(sanitized.recent_workouts[0].confidence, 'low')
    assert.equal(sanitized.recent_workouts[0].elevation_gain_m, null)
    assert.equal(sanitized.recent_workouts[1].confidence, 'high')
    assert.equal(sanitized.signals.hr_zones_may_be_miscalibrated, true)
  })
})

describe('computeLoadBudget', () => {
  it('keeps low-history totals near 1.25x best week without a high floor', () => {
    const sanitized = sanitizePlanInputs({
      metrics: {
        weekly: [
          { week_start: '2026-07-20', total_minutes: 21 },
          { week_start: '2026-07-27', total_minutes: 13.5 },
          { week_start: '2026-08-03', total_minutes: 20.9 },
          { week_start: '2026-08-10', total_minutes: 7.9 },
        ],
        latest_load: { ctl: 8.4, risk: 'low' },
      },
      recent_workouts: [
        { sport: 'running', duration_minutes: 8, distance_km: 1 },
      ],
      profile: { training_frequency_per_week: 3, strength_training: true },
    })
    const budget = computeLoadBudget(sanitized, {
      training_frequency_per_week: 3,
      strength_training: true,
      max_training_minutes_per_day: { sunday: 120 },
    })
    assert.equal(budget.max_total_training_minutes, 36)
    assert.equal(budget.resume_long, false)
    assert.ok(budget.max_long_run_minutes <= budget.max_total_training_minutes)
    assert.equal(budget.max_quality_sessions, 0)
    assert.equal(budget.max_training_sessions, 3)
    assert.equal(budget.max_endurance_sessions, 3)
    assert.equal(budget.max_strength_sessions, 2)
    assert.equal(budget.max_strength_minutes_per_session, 35)
  })

  it('resumes long runs when reliable history dwarfs a weak recent week', () => {
    const sanitized = sanitizePlanInputs({
      metrics: {
        weekly: [
          { week_start: '2026-07-20', total_minutes: 21 },
          { week_start: '2026-07-27', total_minutes: 13.5 },
          { week_start: '2026-08-03', total_minutes: 20.9 },
          { week_start: '2026-08-10', total_minutes: 7.9 },
        ],
        latest_load: { ctl: 8.4, risk: 'low' },
      },
      recent_workouts: [
        { sport: 'running', duration_minutes: 8, distance_km: 1 },
        { sport: 'running', duration_minutes: 79, distance_km: 10.5 },
        { sport: 'running', duration_minutes: 89, distance_km: 31 },
      ],
    })
    const budget = computeLoadBudget(sanitized, {
      training_frequency_per_week: 3,
      strength_training: true,
      max_training_minutes_per_day: { sunday: 120 },
    })
    assert.equal(budget.resume_long, true)
    assert.equal(budget.max_long_run_minutes, 45)
    assert.equal(budget.max_endurance_sessions, 2)
    assert.equal(budget.max_training_sessions, 3)
    assert.ok(budget.max_total_training_minutes >= budget.max_long_run_minutes + 15)
    assert.equal(budget.max_strength_minutes_per_session, 35)
  })

  it('enforces a reduced recovery budget for acute load spikes', () => {
    const sanitized = sanitizePlanInputs({
      metrics: {
        weekly: [
          { week_start: '2026-07-20', total_minutes: 180 },
          { week_start: '2026-07-27', total_minutes: 200 },
          { week_start: '2026-08-03', total_minutes: 240 },
        ],
        latest_load: { ctl: 40, atl: 70, tsb: -30, acwr: 1.65, risk: 'spike' },
      },
      recent_workouts: [
        { sport: 'running', duration_minutes: 70, distance_km: 11 },
        { sport: 'running', duration_minutes: 50, distance_km: 8 },
      ],
    })
    const budget = computeLoadBudget(sanitized, {
      training_frequency_per_week: 5,
      max_weekly_training_minutes: 300,
    })
    assert.equal(budget.recovery_week, true)
    assert.equal(budget.max_quality_sessions, 0)
    assert.equal(budget.max_training_sessions, 3)
    assert.ok(budget.max_total_training_minutes <= 144)
    assert.ok(budget.max_long_run_minutes <= Math.round(budget.max_total_training_minutes * 0.45))
  })
})

describe('reviewAndClampPlan', () => {
  const baseBudget = {
    max_total_training_minutes: 36,
    max_long_run_minutes: 26,
    max_quality_sessions: 0,
    max_training_sessions: 3,
    max_endurance_sessions: 3,
    max_strength_sessions: 2,
    max_strength_minutes_per_session: 35,
    max_strength_minutes_total: 70,
    max_training_minutes_per_day: {},
    allow_quality: false,
    resume_long: false,
    recovery_week: false,
  }

  it('clamps oversized volume, long run, quality count and foreign sports', () => {
    const oversized = planFromDays([
      day({ date: '2026-08-14', day: 'friday', sport: 'running', total_duration_minutes: 30, title: 'Easy' }),
      day({ date: '2026-08-15', day: 'saturday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
      day({ date: '2026-08-16', day: 'sunday', sport: 'running', total_duration_minutes: 45, title: 'Long' }),
      day({ date: '2026-08-17', day: 'monday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
      day({
        date: '2026-08-18',
        day: 'tuesday',
        sport: 'swimming',
        total_duration_minutes: 30,
        title: 'Intervals',
        description: 'Hard interval session',
        target_focus: 'Speed intervals',
      }),
      day({ date: '2026-08-19', day: 'wednesday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
      day({
        date: '2026-08-20',
        day: 'thursday',
        sport: 'running',
        total_duration_minutes: 30,
        title: 'Tempolauf',
        description: 'Tempo run quality',
        target_focus: 'threshold',
      }),
    ])
    const { plan, repairs } = reviewAndClampPlan(oversized, baseBudget, {
      available_sports: ['running', 'strength'],
      preferred_training_days: ['monday', 'friday'],
    })
    const enduranceTotal = plan.days.reduce((sum, item) => (
      item.session_type === 'training' && ['running', 'cycling', 'swimming', 'rowing', 'hiking'].includes(item.sport)
        ? sum + item.total_duration_minutes
        : sum
    ), 0)
    const longestRun = Math.max(0, ...plan.days.filter((item) => item.sport === 'running').map((item) => item.total_duration_minutes))
    const qualityCount = plan.days.filter((item) => isQualitySession(item)).length
    assert.ok(enduranceTotal <= 36)
    assert.ok(longestRun <= 26)
    assert.equal(qualityCount, 0)
    assert.equal(plan.days.find((item) => item.date === '2026-08-18')?.session_type, 'rest')
    assert.ok(repairs.some((item) => item.startsWith('sport_whitelist')))
    assert.ok(repairs.some((item) => item.startsWith('long_clamped') || item.startsWith('total_clamped') || item.startsWith('total_drop')))
  })

  it('does not spend endurance budget on strength minutes', () => {
    const { plan } = reviewAndClampPlan(planFromDays([
      day({ date: '2026-08-14', day: 'friday', sport: 'running', total_duration_minutes: 20, title: 'Easy' }),
      day({ date: '2026-08-15', day: 'saturday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
      day({ date: '2026-08-16', day: 'sunday', sport: 'running', total_duration_minutes: 45, title: 'Long' }),
      day({ date: '2026-08-17', day: 'monday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
      day({ date: '2026-08-18', day: 'tuesday', sport: 'strength', total_duration_minutes: 35, title: 'Kraft' }),
      day({ date: '2026-08-19', day: 'wednesday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
      day({ date: '2026-08-20', day: 'thursday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
    ]), {
      ...baseBudget,
      max_total_training_minutes: 60,
      max_long_run_minutes: 45,
      max_endurance_sessions: 2,
      resume_long: true,
    }, { available_sports: ['running', 'strength'], strength_training: true })
    assert.equal(plan.days.find((item) => item.date === '2026-08-16')?.total_duration_minutes, 45)
    assert.equal(plan.days.find((item) => item.date === '2026-08-18')?.total_duration_minutes, 35)
  })

  it('does not treat Konversationstempo easy runs as quality sessions', () => {
    const easy = day({
      date: '2026-08-14',
      day: 'friday',
      sport: 'running',
      total_duration_minutes: 10,
      title: 'Leichter Wiedereinstiegslauf',
      description: 'Ein sehr leichter Lauf mit angenehmem Tempo.',
      target_focus: 'Aerobe Aktivierung, Körpergefühl',
      workout_steps: [
        { step_duration: '3 Minuten', step_intensity: 'Sehr leicht', step_instruction: 'Gehe zügig.' },
        { step_duration: '5 Minuten', step_intensity: 'Leicht (Zone 2 / Konversationstempo)', step_instruction: 'Jogge unterhaltungsfähig.' },
        { step_duration: '2 Minuten', step_intensity: 'Sehr leicht', step_instruction: 'Gehe langsam.' },
      ],
    })
    assert.equal(isQualitySession(easy), false)
    const { plan } = reviewAndClampPlan(planFromDays([
      easy,
      day({ date: '2026-08-15', day: 'saturday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
      day({ date: '2026-08-16', day: 'sunday', sport: 'running', total_duration_minutes: 15, title: 'Grundlagenlauf', description: 'Locker', target_focus: 'Ausdauer', workout_steps: [
        { step_duration: '15 Minuten', step_intensity: 'Leicht (Konversationstempo)', step_instruction: 'Locker laufen.' },
      ] }),
      day({ date: '2026-08-17', day: 'monday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
      day({ date: '2026-08-18', day: 'tuesday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
      day({ date: '2026-08-19', day: 'wednesday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
      day({ date: '2026-08-20', day: 'thursday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
    ]), baseBudget, { available_sports: ['running', 'strength'] })
    const friday = plan.days.find((item) => item.date === '2026-08-14')
    assert.equal(friday?.title, 'Leichter Wiedereinstiegslauf')
    assert.match(friday?.description || '', /leichter Lauf/i)
    assert.match(friday?.workout_steps[1]?.step_intensity || '', /Konversationstempo/)
  })

  it('normalizes malformed rest days and caps all structured sessions', () => {
    const { plan, repairs } = reviewAndClampPlan(planFromDays([
      day({ date: '2026-08-14', day: 'friday', sport: 'mobility', session_type: 'rest', total_duration_minutes: 20 }),
      day({ date: '2026-08-15', day: 'saturday', sport: 'running', total_duration_minutes: 40 }),
      day({ date: '2026-08-16', day: 'sunday', sport: 'running', total_duration_minutes: 45 }),
      day({ date: '2026-08-17', day: 'monday', sport: 'strength', total_duration_minutes: 30 }),
      day({ date: '2026-08-18', day: 'tuesday', sport: 'running', total_duration_minutes: 30 }),
      day({ date: '2026-08-19', day: 'wednesday', sport: 'strength', total_duration_minutes: 30 }),
      day({ date: '2026-08-20', day: 'thursday', sport: 'other', session_type: 'rest', total_duration_minutes: 0 }),
    ]), {
      ...baseBudget,
      max_total_training_minutes: 150,
      max_long_run_minutes: 60,
      max_training_sessions: 3,
      max_strength_sessions: 2,
      max_strength_minutes_total: 70,
    }, {
      available_sports: ['running', 'strength', 'mobility'],
      preferred_training_days: ['saturday', 'monday', 'wednesday'],
    }, 'de')

    const friday = plan.days.find((item) => item.date === '2026-08-14')
    assert.equal(friday?.session_type, 'rest')
    assert.equal(friday?.sport, 'other')
    assert.equal(friday?.total_duration_minutes, 0)
    assert.equal(plan.days.filter((item) => item.session_type === 'training').length, 3)
    assert.deepEqual(
      plan.days.filter((item) => item.session_type === 'training').map((item) => item.day).sort(),
      ['monday', 'saturday', 'wednesday'],
    )
    assert.ok(repairs.some((item) => item.startsWith('rest_normalized')))
    assert.ok(repairs.some((item) => item.startsWith('training_frequency')))
    assert.doesNotMatch(plan.days.map((item) => item.description).join(' '), /Converted to rest/)
  })
})
