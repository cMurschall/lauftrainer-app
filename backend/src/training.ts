import { z } from 'zod'
import type { Env } from './types'
import { json } from './http'
import { finishReservation, reserveCredit } from './billing'
import {
  computeLoadBudget,
  formatHardCapsBlock,
  reviewAndClampPlan,
  sanitizePlanInputs,
  type LoadBudget,
  type SanitizedInputs,
} from './planSafety'

const weekDayEnum = z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
const coachStyleEnum = z.enum(['mentor', 'pragmatist', 'performance'])

const previousPlanDaySchema = z.object({
  date: z.string().optional(),
  day: z.string(),
  sport: z.string(),
  session_type: z.string(),
  title: z.string(),
  total_duration_minutes: z.number().int().nonnegative(),
  completed: z.boolean(),
}).passthrough()

const requestSchema = z.object({
  locale: z.enum(['de', 'en']).default('de'),
  plan_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coach_style: coachStyleEnum.default('pragmatist'),
  previous_plan: z.object({
    start_date: z.string().optional(),
    week_summary: z.object({
      focus_title: z.string(),
      goal_description: z.string(),
    }).optional(),
    days: z.array(previousPlanDaySchema).max(7),
  }).optional(),
  profile: z.record(z.unknown()).default({}),
  goals: z.array(z.record(z.unknown())).max(20).default([]),
  metrics: z.record(z.unknown()).default({}),
  recent_workouts: z.array(z.record(z.unknown())).max(21).default([]),
  config: z.record(z.unknown()).optional(),
  workouts: z.array(z.record(z.unknown())).max(14).optional(),
})

const stepSchema = z.object({ step_duration: z.string().min(1), step_intensity: z.string().min(1), step_instruction: z.string().min(1) })
const daySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day: weekDayEnum,
  sport: z.enum(['running', 'cycling', 'swimming', 'hiking', 'cardio', 'rowing', 'strength', 'mobility', 'other']),
  sport_label: z.string().trim().min(1).max(40).optional(),
  session_type: z.enum(['training', 'rest']),
  title: z.string().min(1),
  description: z.string().min(1),
  target_focus: z.string().min(1),
  total_duration_minutes: z.number().int().nonnegative(),
  workout_steps: z.array(stepSchema).min(1),
})
const weekSummarySchema = z.object({ focus_title: z.string().min(1), goal_description: z.string().min(1) })
const planSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  week_summary: weekSummarySchema,
  days: z.array(daySchema).length(7),
})
const localGeminiLogUrl = 'http://127.0.0.1:8790/gemini-log'

const responseSchema = {
  type: 'OBJECT',
  properties: {
    week_summary: {
      type: 'OBJECT',
      properties: { focus_title: { type: 'STRING' }, goal_description: { type: 'STRING' } },
      required: ['focus_title', 'goal_description'],
    },
    days: {
      type: 'ARRAY', items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING' },
          day: { type: 'STRING', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
          sport: { type: 'STRING', enum: ['running', 'cycling', 'swimming', 'hiking', 'cardio', 'rowing', 'strength', 'mobility', 'other'] },
          sport_label: { type: 'STRING' },
          session_type: { type: 'STRING', enum: ['training', 'rest'] },
          title: { type: 'STRING' },
          description: { type: 'STRING' },
          target_focus: { type: 'STRING' },
          total_duration_minutes: { type: 'INTEGER' },
          workout_steps: {
            type: 'ARRAY',
            minItems: 1,
            items: {
              type: 'OBJECT',
              properties: {
                step_duration: { type: 'STRING' },
                step_intensity: { type: 'STRING' },
                step_instruction: { type: 'STRING' },
              },
              required: ['step_duration', 'step_intensity', 'step_instruction'],
            },
          },
        },
        required: ['date', 'day', 'sport', 'session_type', 'title', 'description', 'target_focus', 'total_duration_minutes', 'workout_steps'],
      },
    },
  },
  required: ['week_summary', 'days'],
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

export function weekdayFromDateKey(dateKey: string): (typeof WEEKDAYS)[number] {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return WEEKDAYS[date.getUTCDay()]
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export function assertRollingPlan(plan: z.infer<typeof planSchema>, startDate: string): z.infer<typeof planSchema> {
  const expected = Array.from({ length: 7 }, (_, index) => addDaysToDateKey(startDate, index))
  const sortedDays = [...plan.days].sort((a, b) => a.date.localeCompare(b.date))
  const dates = sortedDays.map((day) => day.date)
  if (new Set(dates).size !== 7) throw new Error('Plan days must have unique dates.')
  for (let index = 0; index < 7; index += 1) {
    const day = sortedDays[index]
    if (day.date !== expected[index]) throw new Error(`Plan day ${index + 1} must be ${expected[index]}.`)
    if (day.day !== weekdayFromDateKey(day.date)) throw new Error(`Plan day ${day.date} has mismatched weekday.`)
  }
  return { ...plan, start_date: startDate, days: sortedDays }
}

export async function createTrainingPlan(request: Request, env: Env): Promise<Response> {
  const requestId = request.headers.get('X-Idempotency-Key')?.trim()
  if (!requestId || requestId.length > 128) return json({ detail: 'X-Idempotency-Key fehlt oder ist ungültig.' }, 400, request, env)
  const localMode = env.TRAINING_PLAN_MODE === 'mock' || env.TRAINING_PLAN_MODE === 'local'
  const reservation = localMode
    ? { error: undefined, reservationId: undefined, replay: undefined }
    : await reserveCredit(request, env, requestId)
  const releaseReservation = async () => {
    if (reservation.reservationId) await finishReservation(env, reservation.reservationId, null, false)
  }
  if (reservation.error) return reservation.error
  if (reservation.replay) return reservation.replay.result_json ? json({ plan: JSON.parse(reservation.replay.result_json), replay: true }, 200, request, env) : json({ detail: 'Diese Anfrage wird bereits verarbeitet.' }, 409, request, env)
  const rawBody = await request.text()
  if (rawBody.length > 128 * 1024) return json({ detail: 'Request ist zu groß.' }, 413, request, env)
  let body: unknown
  try { body = JSON.parse(rawBody) } catch { return json({ detail: 'Ungültiges JSON.' }, 400, request, env) }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return json({ detail: 'Ungültige Trainingsdaten.', issues: parsed.error.issues }, 400, request, env)
  const sanitized = sanitizePlanInputs({
    metrics: parsed.data.metrics,
    recent_workouts: parsed.data.recent_workouts,
    workouts: parsed.data.workouts,
    profile: parsed.data.profile,
  })
  const budget = computeLoadBudget(sanitized, parsed.data.profile)
  if (env.TRAINING_PLAN_MODE === 'mock' || (env.TRAINING_PLAN_MODE === 'local' && !env.GEMINI_API_KEY) || !env.GEMINI_API_KEY) {
    const reviewed = reviewAndClampPlan(
      createDebugPlan(parsed.data.locale, parsed.data.plan_start_date, budget),
      budget,
      parsed.data.profile,
      parsed.data.locale,
    )
    if (reservation.reservationId) await finishReservation(env, reservation.reservationId, reviewed.plan, true)
    const payload = env.TRAINING_PLAN_MODE === 'local'
      ? { plan: reviewed.plan, debug: true, detail: 'Lokaler Mock-Trainingsplan.', meta: { load_budget: budget, repairs: reviewed.repairs } }
      : { plan: reviewed.plan, debug: true, detail: 'Lokaler Mock-Trainingsplan.' }
    return json(payload, 200, request, env)
  }
  const prompt = createPromptEnglish(parsed.data, sanitized, budget)
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash'
  const geminiBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.2 } }
  let response: Response
  try { response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiBody),
    signal: AbortSignal.timeout(45_000),
  }) } catch (error) {
    await logLocalGeminiCall(env, { requestId, model, prompt, geminiBody }, { error: error instanceof Error ? error.message : String(error) })
    await releaseReservation()
    return json({ detail: 'Gemini ist momentan nicht erreichbar.' }, 502, request, env)
  }
  const responseText = await response.text()
  let responseBody: unknown = responseText
  try { responseBody = JSON.parse(responseText) } catch { /* Keep non-JSON error responses readable in the log. */ }
  await logLocalGeminiCall(env, { requestId, model, prompt, geminiBody }, { status: response.status, statusText: response.statusText, body: responseBody })
  if (!response.ok) { await releaseReservation(); return json({ detail: `Gemini antwortete mit ${response.status}.` }, 502, request, env) }
  const payload = JSON.parse(responseText) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')
  if (!text) {
    await releaseReservation()
    return json({ detail: 'Gemini lieferte keine verwertbare Antwort.' }, 502, request, env)
  }
  let plan: z.infer<typeof planSchema>
  let repairs: string[] = []
  try {
    plan = assertRollingPlan(planSchema.parse(normalizePlan(parseJson(text))), parsed.data.plan_start_date)
    const reviewed = reviewAndClampPlan(plan, budget, parsed.data.profile, parsed.data.locale)
    plan = planSchema.parse(reviewed.plan)
    repairs = reviewed.repairs
  } catch (error) {
    await releaseReservation()
    throw error
  }
  if (reservation.reservationId) await finishReservation(env, reservation.reservationId, plan, true)
  if (env.TRAINING_PLAN_MODE === 'local') return json({ plan, meta: { load_budget: budget, repairs } }, 200, request, env)
  return json({ plan }, 200, request, env)
}

async function logLocalGeminiCall(
  env: Env,
  request: { requestId: string, model: string, prompt: string, geminiBody: unknown },
  response: unknown,
): Promise<void> {
  if (env.TRAINING_PLAN_MODE !== 'local') return
  try {
    await fetch(localGeminiLogUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: { ...request, sentAt: new Date().toISOString() },
        response: { ...response as Record<string, unknown>, receivedAt: new Date().toISOString() },
      }),
      signal: AbortSignal.timeout(2_000),
    })
  } catch (error) {
    console.warn('Lokales Gemini-Logging fehlgeschlagen:', error)
  }
}

function defaultWorkoutSteps(sessionType: string, description: unknown): Array<{
  step_duration: string
  step_intensity: string
  step_instruction: string
}> {
  const instruction = typeof description === 'string' && description.trim()
    ? description.trim()
    : (sessionType === 'rest' ? 'Rest day' : 'Complete the session as planned.')
  return [{
    step_duration: sessionType === 'rest' ? 'Rest day' : 'Session',
    step_intensity: sessionType === 'rest' ? 'Recovery' : 'Easy',
    step_instruction: instruction,
  }]
}

export function normalizePlan(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const plan = value as Record<string, unknown>
  if (!Array.isArray(plan.days)) return value
  return {
    ...plan,
    days: plan.days.map((day) => {
      if (!day || typeof day !== 'object' || Array.isArray(day)) return day
      const item = day as Record<string, unknown>
      const date = typeof item.date === 'string' ? item.date : undefined
      const session_type = normalizeSessionType(item.session_type)
      const steps = Array.isArray(item.workout_steps)
        ? item.workout_steps.filter((step) => step && typeof step === 'object' && !Array.isArray(step))
        : []
      return {
        ...item,
        date,
        day: date ? weekdayFromDateKey(date) : item.day,
        sport: normalizeSport(item.sport),
        session_type,
        workout_steps: steps.length ? steps : defaultWorkoutSteps(session_type, item.description),
      }
    }),
  }
}

function normalizeSport(value: unknown): string {
  const sport = String(value ?? '').trim().toLowerCase()
  const aliases: Record<string, string> = {
    run: 'running', running: 'running',
    ride: 'cycling', bike: 'cycling', cycling: 'cycling',
    swim: 'swimming', swimming: 'swimming',
    hike: 'hiking', hiking: 'hiking', walk: 'hiking', walking: 'hiking',
    cardio: 'cardio', ergometer: 'cardio', treadmill: 'cardio', elliptical: 'cardio',
    crosstrainer: 'cardio', spinning: 'cardio', indoor: 'cardio',
    row: 'cardio', rowing: 'cardio',
    strength: 'strength', mobility: 'mobility', yoga: 'mobility',
    rest: 'other', recovery: 'other', other: 'other',
  }
  return aliases[sport] || sport
}

function normalizeSessionType(value: unknown): string {
  const sessionType = String(value ?? '').trim().toLowerCase()
  if (['rest', 'recovery', 'rest day', 'recovery day'].includes(sessionType)) return 'rest'
  return 'training'
}

function createDebugPlan(locale: 'de' | 'en', startDate: string, budget: LoadBudget): z.infer<typeof planSchema> {
  const english = locale === 'en'
  const longMinutes = Math.max(0, Math.min(budget.max_long_run_minutes, Math.max(15, Math.round(budget.max_total_training_minutes * 0.45))))
  const easyMinutes = Math.max(0, Math.min(30, Math.max(0, budget.max_total_training_minutes - longMinutes)))
  const templates = english
    ? [
        ['Rest', 'TEST PLAN — no Gemini key configured.', 'Recovery', 0],
        ['Running', 'TEST PLAN — easy aerobic run.', 'Base endurance', easyMinutes],
        ['Rest', 'TEST PLAN — recovery day.', 'Recovery', 0],
        ['Rest', 'TEST PLAN — recovery day.', 'Recovery', 0],
        ['Rest', 'TEST PLAN — recovery day.', 'Recovery', 0],
        ['Running', 'TEST PLAN — relaxed long run.', 'Endurance', longMinutes],
        ['Rest', 'TEST PLAN — recovery day.', 'Recovery', 0],
      ] as const
    : [
        ['Rest', 'TESTPLAN — Gemini-Key ist nicht konfiguriert.', 'Erholung', 0],
        ['Running', 'TESTPLAN — lockerer aerober Lauf.', 'Grundlagenausdauer', easyMinutes],
        ['Rest', 'TESTPLAN — Erholungstag.', 'Erholung', 0],
        ['Rest', 'TESTPLAN — Erholungstag.', 'Erholung', 0],
        ['Rest', 'TESTPLAN — Erholungstag.', 'Erholung', 0],
        ['Running', 'TESTPLAN — entspannter langer Lauf.', 'Ausdauer', longMinutes],
        ['Rest', 'TESTPLAN — Erholungstag.', 'Erholung', 0],
      ] as const
  const summary = english
    ? { focus_title: 'Aerobic base and recovery', goal_description: 'Build consistent endurance while allowing recovery between demanding sessions over the next 7 days.' }
    : { focus_title: 'Aerobe Basis und Erholung', goal_description: 'Baue deine Ausdauer in den nächsten 7 Tagen kontinuierlich auf und lasse zwischen fordernden Einheiten bewusst Erholung zu.' }
  return assertRollingPlan(planSchema.parse({
    start_date: startDate,
    week_summary: summary,
    days: templates.map(([sport, description, focus, duration], index) => {
      const date = addDaysToDateKey(startDate, index)
      return {
        date,
        day: weekdayFromDateKey(date),
        sport: sport.toLowerCase() === 'rest' ? 'other' : sport.toLowerCase(),
        session_type: sport.toLowerCase() === 'rest' ? 'rest' : 'training',
        title: focus,
        description,
        target_focus: focus,
        total_duration_minutes: duration,
        workout_steps: [{
          step_duration: duration ? `${duration} min` : (english ? 'Rest day' : 'Ruhetag'),
          step_intensity: duration ? (english ? 'Easy' : 'Locker') : (english ? 'Recovery' : 'Erholung'),
          step_instruction: description,
        }],
      }
    }),
  }), startDate)
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  try { return JSON.parse(trimmed) } catch {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]
    if (fenced) return JSON.parse(fenced)
    const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('Gemini lieferte kein gültiges JSON-Objekt.')
  }
}

function coachStyleBlock(style: z.infer<typeof coachStyleEnum>): string {
  if (style === 'mentor') {
    return [
      'COACH_STYLE: mentor',
      'Tone: encouraging, empathetic, sustainable. Prioritize joy, recovery, and listening to the body.',
      'Do not ignore safety guardrails. Soft language never overrides load limits.',
    ].join('\n')
  }
  if (style === 'performance') {
    return [
      'COACH_STYLE: performance',
      'Tone: focused, disciplined, direct. Emphasize pacing discipline and race goals when safe.',
      'Do not ignore safety guardrails. Ambition never overrides recovery or volume caps.',
    ].join('\n')
  }
  return [
    'COACH_STYLE: pragmatist',
    'Tone: concise, practical, low-jargon. Keep instructions everyday-ready and simple.',
    'Do not ignore safety guardrails.',
  ].join('\n')
}

function goalContext(goals: Array<Record<string, unknown>>, planStartDate: string): string {
  const upcoming = goals
    .map((goal) => {
      const date = typeof goal.date === 'string' ? goal.date.slice(0, 10) : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < planStartDate) return null
      const start = Date.parse(`${planStartDate}T00:00:00Z`)
      const target = Date.parse(`${date}T00:00:00Z`)
      const daysToGoal = Math.round((target - start) / 86_400_000)
      return {
        title: goal.title,
        date,
        days_to_goal: daysToGoal,
        distance_km: goal.distance_km,
        priority: goal.priority || 'B',
        sport: goal.sport,
        notes: goal.notes,
      }
    })
    .filter(Boolean)
  const pastIgnored = goals.filter((goal) => {
    const date = typeof goal.date === 'string' ? goal.date.slice(0, 10) : ''
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < planStartDate
  }).length
  return [
    `PLAN_START_DATE: ${planStartDate}`,
    `PLAN_END_DATE: ${addDaysToDateKey(planStartDate, 6)}`,
    `UPCOMING_GOALS: ${JSON.stringify(upcoming)}`,
    `IGNORED_PAST_GOALS_COUNT: ${pastIgnored}`,
    'Prioritize A-goals. If the nearest A/B race is within 14 days, bias toward sharpening/taper rather than big volume jumps. If 15-42 days, use controlled base/build. If farther or none, rebuild conservatively from recent load.',
  ].join('\n')
}

function createPromptEnglish(
  data: z.infer<typeof requestSchema>,
  sanitized: SanitizedInputs,
  budget: LoadBudget,
): string {
  const outputLanguage = data.locale === 'de' ? 'German' : 'English'
  const expectedDates = Array.from({ length: 7 }, (_, index) => {
    const date = addDaysToDateKey(data.plan_start_date, index)
    return `${date} (${weekdayFromDateKey(date)})`
  })
  const instructions = [
    'You are a professional endurance training coach.',
    'Create a safe and realistic rolling 7-day training plan starting on PLAN_START_DATE (day 1 = that calendar date, not Monday).',
    `OUTPUT_LANGUAGE: ${outputLanguage}. Write all human-readable text in this language.`,
    'Keep all JSON property names and enum values exactly as defined in the schema; do not translate them.',
    'Return a JSON object with week_summary and days, never a bare array.',
    'week_summary must contain a personalized focus_title and goal_description explaining why these next 7 days are structured this way.',
    'days must contain exactly 7 objects in chronological order for the dates listed in EXPECTED_DATES.',
    'Each day needs date (YYYY-MM-DD) and day (weekday enum matching that date).',
    'Use measured local metrics as the primary basis for load decisions.',
    'Treat profile.available_sports as a strict whitelist. Never schedule a sport that is not listed there.',
    'Use only sports from the available_sports whitelist, including cardio, strength, or mobility only when explicitly enabled.',
    'CUSTOM SPORTS: If available_sports contains a label that is not one of the sport enums, schedule it with sport "other" and sport_label set to that exact whitelist label. Never invent sport_label values.',
    'Respect profile, goals, preferred days, and HARD_CAPS relative to this rolling window.',
    'FREQUENCY: training_frequency_per_week is the maximum number of all structured training days combined, including endurance, strength, and mobility. Never add strength or active recovery on top of that count. Prefer scheduling on preferred_training_days.',
    'PREFERRED DAYS: Schedule structured sessions only on preferred_training_days when that list contains enough days for the requested frequency. Days outside that list should be rest days unless necessary to avoid unsafe back-to-back hard sessions.',
    'REST INVARIANT: A rest day must use session_type "rest", sport "other", no sport_label, total_duration_minutes 0, and one no-exercise recovery TODO. Any active recovery, walk, mobility, or other timed activity is a training day and counts toward the frequency cap.',
    'Manage load conservatively using CTL, ATL, TSB, and ACWR. Schedule recovery when fatigue or risk signals are present.',
    'VOLUME GUARDRAIL: Obey HARD_CAPS exactly. max_endurance_minutes is for running/cycling/etc only; strength has its own caps and does not consume the endurance budget.',
    'BUDGET CHECK: Before returning JSON, add all endurance-day durations and verify the sum is <= max_endurance_minutes, every run is <= max_long_run_minutes, and the count of all non-rest days is <= max_training_sessions. For very small budgets, use short run/walk sessions; do not draft a normal week and rely on later correction.',
    budget.resume_long
      ? 'RESUME_LONG: true. Athlete has proven longer runs despite a weak recent week. Prefer 1 long run near max_long_run_minutes plus at most one short easy run; do not crush the long into tiny minutes.'
      : 'If recent weeks are very low and resume_long is false, rebuild gradually with shorter sessions.',
    `INTENSITY GUARDRAIL: Prefer easy aerobic work when fitness is low or history is sparse. Schedule at most ${budget.max_quality_sessions} quality session(s) in these 7 days.`,
    budget.recovery_week
      ? 'RECOVERY_WEEK: true. Acute load is unsafe (risk spike, very negative TSB, or high ACWR). Reduce endurance volume substantially, keep every session easy, and prioritize full rest.'
      : 'RECOVERY_WEEK: false.',
    'LIMITATIONS: Treat stated pain, injury, rehabilitation, and explicit "do not" constraints as hard safety restrictions. Acknowledge relevant limitations in the week summary and include clear stop/adjust guidance without diagnosing.',
    'PLAN_NOTES: Treat profile.plan_notes as soft preferences for this rolling window only (travel, schedule wishes, equipment). Do not override safety caps, limitations, or HARD_CAPS.',
    'SESSION DETAIL: Every training day needs concrete warm-up, main set, and cool-down steps. For strength, prescribe specific exercises, sets, and reps (e.g. squats, lunges, hinge, plank, glute bridge) instead of vague "choose exercises".',
    'Create exactly one actionable TODO for each of seven days, including rest days.',
    sanitized.signals.hr_zones_may_be_miscalibrated
      ? 'HR_ZONES_MAY_BE_MISCALIBRATED: true. Prioritize perceived effort / conversational pace; treat HR zones only as rough guidance.'
      : 'Use heart-rate zones only when they are provided.',
    'All step_duration, step_intensity, and step_instruction values must be JSON strings.',
    'Unknown personal information stays unknown. Do not invent it.',
    'If PREVIOUS_PLAN is provided, continue logically from completion status: completed sessions can progress; skipped/incomplete hard sessions should be delayed or softened; do not blindly repeat an unfinished aggressive plan.',
    'Return only valid JSON without Markdown.',
    coachStyleBlock(data.coach_style),
  ]
  const schema = 'JSON schema: week_summary has focus_title and goal_description; days is an array of exactly seven objects. Each day needs date, day, sport, session_type, title, description, target_focus, total_duration_minutes, and workout_steps. Optional sport_label is only for custom sports with sport "other". Each step needs step_duration, step_intensity, and step_instruction.'
  return [
    ...instructions,
    schema,
    '',
    goalContext(data.goals, data.plan_start_date),
    `EXPECTED_DATES: ${expectedDates.join(', ')}`,
    formatHardCapsBlock(budget),
    `SANITIZED_SIGNALS: ${JSON.stringify(sanitized.signals)}`,
    `BUDGET_BASIS: ${JSON.stringify({
      best_recent_week_minutes: sanitized.best_recent_week_minutes,
      longest_reliable_run_minutes: sanitized.longest_reliable_run_minutes,
      reliable_run_count: sanitized.reliable_run_count,
    })}`,
    '',
    'USER_PROFILE:',
    JSON.stringify(data.profile),
    'GOALS:',
    JSON.stringify(data.goals),
    'MEASURED_METRICS:',
    JSON.stringify({
      ...data.metrics,
      weekly: sanitized.weekly,
      latest_load: sanitized.latest_load,
    }),
    'RECENT_WORKOUTS:',
    JSON.stringify(sanitized.recent_workouts),
    'PREVIOUS_PLAN:',
    JSON.stringify(data.previous_plan || null),
  ].join('\n')
}
