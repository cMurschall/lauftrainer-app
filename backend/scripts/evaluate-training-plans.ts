import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createTrainingPlan } from '../src/training.ts'
import { isQualitySession, type LoadBudget, type TrainingPlanLike } from '../src/planSafety.ts'
import type { Env } from '../src/types.ts'

type Locale = 'de' | 'en'
type CoachStyle = 'mentor' | 'pragmatist' | 'performance'

interface ScenarioExpectation {
  maxQuality?: number
  minRestDays?: number
  minTrainingDays?: number
  maxTrainingDays?: number
  requiredSports?: string[]
  forbiddenSports?: string[]
  preferredDays?: string[]
  limitationTerms?: string[]
}

interface Scenario {
  id: string
  label: string
  rationale: string
  locale: Locale
  coachStyle: CoachStyle
  body: Record<string, unknown>
  expect: ScenarioExpectation
}

interface CliOptions {
  maxCalls: number
  model: string
  outputDir: string
  scenarioIds: string[]
}

interface WorkerPayload {
  plan?: TrainingPlanLike
  detail?: string
  meta?: {
    load_budget?: LoadBudget
    repairs?: string[]
  }
}

const startDate = '2026-08-14'
const baseProfile = {
  name: '',
  training_goal: 'Gesund und nachhaltig Ausdauer aufbauen',
  preferred_training_days: ['tuesday', 'thursday', 'sunday'],
  training_frequency_per_week: 3,
  primary_sports: ['running'],
  available_sports: ['running'],
  max_weekly_training_minutes: 240,
  max_training_minutes_per_day: { tuesday: 60, thursday: 60, sunday: 100 },
  strength_training: false,
  performance_notes: '',
  limitations: '',
  personal_notes: '',
  thresholds: { hr_rest: 52, lthr: 170, hr_max: 190 },
  hr_zones: { z1: [95, 114], z2: [115, 133], z3: [134, 152], z4: [153, 171], z5: [172, 190] },
}

function weekly(minutes: number[]): Array<Record<string, unknown>> {
  const dates = ['2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03']
  return minutes.map((total_minutes, index) => ({
    week_start: dates[index],
    total_minutes,
    running_minutes: total_minutes,
  }))
}

function runs(durations: number[], averageHr = 132): Array<Record<string, unknown>> {
  return durations.map((duration_minutes, index) => ({
    date: `2026-08-${String(12 - index).padStart(2, '0')}`,
    sport: 'running',
    duration_minutes,
    distance_km: Math.round((duration_minutes / 6) * 10) / 10,
    avg_hr: averageHr + (index % 3),
    elevation_gain_m: 40,
  }))
}

const scenarios: Scenario[] = [
  {
    id: 'new-runner-no-history',
    label: 'Neue Läuferin ohne Historie',
    rationale: 'Prüft den konservativen Fallback bei fehlenden Messdaten.',
    locale: 'de',
    coachStyle: 'mentor',
    body: {
      profile: {
        ...baseProfile,
        training_goal: 'Regelmäßig mit dem Laufen beginnen',
        training_frequency_per_week: 2,
        preferred_training_days: ['wednesday', 'sunday'],
        max_weekly_training_minutes: 90,
      },
      goals: [],
      metrics: { latest_load: null, weekly: [] },
      recent_workouts: [],
    },
    expect: { maxQuality: 0, minRestDays: 5, maxTrainingDays: 2, requiredSports: ['running'] },
  },
  {
    id: 'fatigued-runner-spike',
    label: 'Ermüdeter Läufer mit Belastungsspitze',
    rationale: 'Prüft, ob TSB, ACWR und Risikosignal zu einer Entlastungswoche führen.',
    locale: 'de',
    coachStyle: 'pragmatist',
    body: {
      profile: baseProfile,
      goals: [],
      metrics: {
        latest_load: { date: '2026-08-13', ctl: 34, atl: 63, tsb: -29, acwr: 1.68, risk: 'spike' },
        weekly: weekly([170, 185, 195, 245]),
      },
      recent_workouts: runs([75, 55, 50, 45, 40, 35], 148),
    },
    expect: { maxQuality: 0, minRestDays: 4, maxTrainingDays: 3 },
  },
  {
    id: 'steady-base-runner',
    label: 'Stabiler Grundlagenläufer',
    rationale: 'Prüft eine normale Aufbauwoche mit einem kontrollierten Qualitätsreiz.',
    locale: 'de',
    coachStyle: 'pragmatist',
    body: {
      profile: {
        ...baseProfile,
        training_frequency_per_week: 4,
        preferred_training_days: ['monday', 'wednesday', 'friday', 'sunday'],
      },
      goals: [],
      metrics: {
        latest_load: { date: '2026-08-13', ctl: 36, atl: 38, tsb: -2, acwr: 1.03, risk: 'low' },
        weekly: weekly([175, 190, 185, 200]),
      },
      recent_workouts: runs([85, 50, 45, 40, 35, 45, 30]),
    },
    expect: { maxQuality: 1, minRestDays: 3, minTrainingDays: 3, requiredSports: ['running'] },
  },
  {
    id: 'five-k-taper',
    label: '5-km-A-Wettkampf in acht Tagen',
    rationale: 'Prüft Tapering, Wettkampfnähe und Priorisierung eines A-Ziels.',
    locale: 'de',
    coachStyle: 'performance',
    body: {
      profile: {
        ...baseProfile,
        training_goal: '5 km unter 22 Minuten',
        training_frequency_per_week: 4,
        preferred_training_days: ['friday', 'sunday', 'tuesday', 'thursday'],
      },
      goals: [
        {
          type: 'race',
          title: 'Stadtlauf 5 km',
          date: '2026-08-22',
          sport: 'running',
          distance_km: 5,
          target_time: '00:22:00',
          priority: 'A',
        },
      ],
      metrics: {
        latest_load: { date: '2026-08-13', ctl: 42, atl: 39, tsb: 3, acwr: 0.96, risk: 'low' },
        weekly: weekly([210, 225, 230, 205]),
      },
      recent_workouts: runs([80, 55, 45, 50, 40, 35, 45]),
    },
    expect: { maxQuality: 1, minRestDays: 3, maxTrainingDays: 4 },
  },
  {
    id: 'marathon-build',
    label: 'Marathon-A-Ziel in fünf Wochen',
    rationale: 'Prüft kontrollierten Aufbau bei einem nahen Langdistanzziel.',
    locale: 'de',
    coachStyle: 'performance',
    body: {
      profile: {
        ...baseProfile,
        training_goal: 'Marathon sicher finishen',
        training_frequency_per_week: 4,
        max_weekly_training_minutes: 360,
        preferred_training_days: ['tuesday', 'thursday', 'saturday', 'sunday'],
        max_training_minutes_per_day: { tuesday: 70, thursday: 70, saturday: 50, sunday: 150 },
      },
      goals: [
        {
          type: 'race',
          title: 'Herbstmarathon',
          date: '2026-09-20',
          sport: 'running',
          distance_km: 42.2,
          priority: 'A',
        },
      ],
      metrics: {
        latest_load: { date: '2026-08-13', ctl: 54, atl: 56, tsb: -2, acwr: 1.04, risk: 'low' },
        weekly: weekly([270, 285, 300, 310]),
      },
      recent_workouts: runs([125, 70, 60, 55, 50, 45, 90]),
    },
    expect: { maxQuality: 1, minRestDays: 3, minTrainingDays: 3, maxTrainingDays: 4 },
  },
  {
    id: 'cycling-only',
    label: 'Reiner Radsportler',
    rationale: 'Prüft die Sport-Whitelist ohne Lauftraining.',
    locale: 'en',
    coachStyle: 'pragmatist',
    body: {
      profile: {
        ...baseProfile,
        training_goal: 'Improve aerobic cycling endurance',
        primary_sports: ['cycling'],
        available_sports: ['cycling'],
        training_frequency_per_week: 3,
      },
      goals: [],
      metrics: {
        latest_load: { date: '2026-08-13', ctl: 31, atl: 30, tsb: 1, acwr: 0.98, risk: 'low' },
        weekly: weekly([190, 205, 215, 200]).map((week) => ({
          ...week,
          cycling_minutes: week.total_minutes,
          running_minutes: 0,
        })),
      },
      recent_workouts: runs([80, 65, 55, 70]).map((workout) => ({ ...workout, sport: 'cycling', distance_km: 30 })),
    },
    expect: {
      maxQuality: 1,
      minRestDays: 4,
      maxTrainingDays: 3,
      requiredSports: ['cycling'],
      forbiddenSports: ['running'],
    },
  },
  {
    id: 'mixed-strength-time-limits',
    label: 'Laufen plus Kraft mit engen Tageslimits',
    rationale: 'Prüft Sportauswahl, Kraftdetails und tägliche Zeitgrenzen.',
    locale: 'de',
    coachStyle: 'mentor',
    body: {
      profile: {
        ...baseProfile,
        available_sports: ['running', 'strength', 'mobility'],
        strength_training: true,
        training_frequency_per_week: 3,
        preferred_training_days: ['monday', 'wednesday', 'saturday'],
        max_weekly_training_minutes: 180,
        max_training_minutes_per_day: { monday: 30, wednesday: 35, saturday: 60 },
        personal_notes: 'Krafttraining zu Hause, Kurzhanteln vorhanden.',
      },
      goals: [],
      metrics: {
        latest_load: { date: '2026-08-13', ctl: 28, atl: 29, tsb: -1, acwr: 1.02, risk: 'low' },
        weekly: weekly([135, 145, 150, 140]),
      },
      recent_workouts: runs([55, 40, 35, 45, 30]),
    },
    expect: {
      maxQuality: 1,
      minRestDays: 2,
      requiredSports: ['running', 'strength'],
      forbiddenSports: ['cycling', 'swimming'],
    },
  },
  {
    id: 'knee-limitation',
    label: 'Läuferin mit Kniebeschwerden',
    rationale: 'Prüft, ob Freitext-Limitierungen sichtbar und konservativ berücksichtigt werden.',
    locale: 'de',
    coachStyle: 'mentor',
    body: {
      profile: {
        ...baseProfile,
        available_sports: ['running', 'cycling', 'mobility'],
        limitations:
          'Aktuell leichte Schmerzen an der Außenseite des rechten Knies. Keine Intervalle, kein Bergablaufen.',
        personal_notes: 'Radfahren ist beschwerdefrei möglich.',
      },
      goals: [],
      metrics: {
        latest_load: { date: '2026-08-13', ctl: 29, atl: 35, tsb: -6, acwr: 1.15, risk: 'moderate' },
        weekly: weekly([155, 165, 170, 150]),
      },
      recent_workouts: runs([50, 45, 40, 35, 30]),
    },
    expect: {
      maxQuality: 0,
      minRestDays: 3,
      forbiddenSports: [],
      limitationTerms: ['knie', 'schmerz', 'beschwer', 'abbruch', 'rad'],
    },
  },
  {
    id: 'missed-previous-quality',
    label: 'Ausgelassene harte Einheit aus Vorwoche',
    rationale: 'Prüft Planfortschreibung statt blindem Nachholen.',
    locale: 'de',
    coachStyle: 'pragmatist',
    body: {
      profile: { ...baseProfile, training_frequency_per_week: 4 },
      goals: [],
      metrics: {
        latest_load: { date: '2026-08-13', ctl: 33, atl: 37, tsb: -4, acwr: 1.08, risk: 'low' },
        weekly: weekly([175, 180, 190, 155]),
      },
      recent_workouts: runs([70, 45, 40, 35, 30]),
      previous_plan: {
        start_date: '2026-08-07',
        week_summary: { focus_title: 'Grundlage und Schwelle', goal_description: 'Kontrollierter Aufbau' },
        days: [
          {
            date: '2026-08-07',
            day: 'friday',
            sport: 'running',
            session_type: 'training',
            title: 'Locker',
            total_duration_minutes: 40,
            completed: true,
          },
          {
            date: '2026-08-09',
            day: 'sunday',
            sport: 'running',
            session_type: 'training',
            title: 'Langer Lauf',
            total_duration_minutes: 70,
            completed: true,
          },
          {
            date: '2026-08-11',
            day: 'tuesday',
            sport: 'running',
            session_type: 'training',
            title: 'Schwellenintervalle',
            total_duration_minutes: 50,
            completed: false,
          },
        ],
      },
    },
    expect: { maxQuality: 1, minRestDays: 3, maxTrainingDays: 4 },
  },
  {
    id: 'non-monday-rolling-plan',
    label: 'Rolling Plan ab Freitag',
    rationale: 'Prüft Datumslogik und Präferenzen über eine Kalenderwochengrenze.',
    locale: 'en',
    coachStyle: 'performance',
    body: {
      profile: {
        ...baseProfile,
        training_goal: 'Maintain fitness during a busy week',
        preferred_training_days: ['friday', 'monday', 'wednesday'],
        training_frequency_per_week: 3,
        max_training_minutes_per_day: { friday: 35, monday: 45, wednesday: 40 },
      },
      goals: [],
      metrics: {
        latest_load: { date: '2026-08-13', ctl: 30, atl: 28, tsb: 2, acwr: 0.95, risk: 'low' },
        weekly: weekly([140, 150, 145, 150]),
      },
      recent_workouts: runs([55, 45, 35, 40, 30]),
    },
    expect: { maxQuality: 1, minRestDays: 4, maxTrainingDays: 3, preferredDays: ['friday', 'monday', 'wednesday'] },
  },
]

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    maxCalls: 30,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    outputDir: resolve(process.cwd(), 'output', 'plan-evaluation'),
    scenarioIds: scenarios.map((scenario) => scenario.id),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--max-calls') options.maxCalls = Math.min(30, Math.max(1, Number(argv[++index] || 30)))
    else if (argument === '--model') options.model = argv[++index] || options.model
    else if (argument === '--out-dir') options.outputDir = resolve(argv[++index] || options.outputDir)
    else if (argument === '--scenario') options.scenarioIds = (argv[++index] || '').split(',').filter(Boolean)
    else if (argument === '--help' || argument === '-h') {
      console.log(
        'Usage: tsx scripts/evaluate-training-plans.ts [--max-calls 10] [--scenario id,id] [--out-dir path] [--model name]',
      )
      process.exit(0)
    } else throw new Error(`Unbekanntes Argument: ${argument}`)
  }
  return options
}

function planText(plan: TrainingPlanLike): string {
  return [
    plan.week_summary.focus_title,
    plan.week_summary.goal_description,
    ...plan.days.flatMap((day) => [
      day.title,
      day.description,
      day.target_focus,
      ...day.workout_steps.flatMap((step) => [step.step_intensity, step.step_instruction]),
    ]),
  ]
    .join(' ')
    .toLowerCase()
}

function evaluate(
  scenario: Scenario,
  plan: TrainingPlanLike,
  budget: LoadBudget | undefined,
  repairs: string[],
): Record<string, unknown> {
  const trainingDays = plan.days.filter((day) => day.session_type === 'training')
  const restDays = plan.days.length - trainingDays.length
  const qualityDays = plan.days.filter(isQualitySession)
  const usedSports = [...new Set(trainingDays.map((day) => day.sport))]
  const text = planText(plan)
  const failures: string[] = []
  const warnings: string[] = []

  if (scenario.expect.maxQuality !== undefined && qualityDays.length > scenario.expect.maxQuality)
    failures.push(`quality ${qualityDays.length} > ${scenario.expect.maxQuality}`)
  if (scenario.expect.minRestDays !== undefined && restDays < scenario.expect.minRestDays)
    failures.push(`rest days ${restDays} < ${scenario.expect.minRestDays}`)
  if (scenario.expect.minTrainingDays !== undefined && trainingDays.length < scenario.expect.minTrainingDays)
    failures.push(`training days ${trainingDays.length} < ${scenario.expect.minTrainingDays}`)
  if (scenario.expect.maxTrainingDays !== undefined && trainingDays.length > scenario.expect.maxTrainingDays)
    failures.push(`training days ${trainingDays.length} > ${scenario.expect.maxTrainingDays}`)
  for (const sport of scenario.expect.requiredSports || []) {
    if (!usedSports.includes(sport)) failures.push(`required sport missing: ${sport}`)
  }
  for (const sport of scenario.expect.forbiddenSports || []) {
    if (usedSports.includes(sport)) failures.push(`forbidden sport used: ${sport}`)
  }
  if (scenario.expect.preferredDays?.length) {
    const outside = trainingDays.filter((day) => !scenario.expect.preferredDays?.includes(day.day))
    if (outside.length) failures.push(`training outside preferred days: ${outside.map((day) => day.day).join(', ')}`)
  }
  if (scenario.expect.limitationTerms?.length && !scenario.expect.limitationTerms.some((term) => text.includes(term))) {
    failures.push('limitation not visibly acknowledged')
  }

  for (const day of plan.days) {
    if (day.session_type === 'rest' && day.total_duration_minutes !== 0)
      failures.push(`${day.date}: rest day has ${day.total_duration_minutes} min`)
    if (day.session_type === 'training' && day.total_duration_minutes <= 0)
      failures.push(`${day.date}: training has no duration`)
    if (!day.workout_steps.length) failures.push(`${day.date}: no workout steps`)
    const limit = budget?.max_training_minutes_per_day[day.day]
    if (limit && day.total_duration_minutes > limit)
      failures.push(`${day.date}: ${day.total_duration_minutes} min > daily cap ${limit}`)
  }

  if (repairs.length) warnings.push(`${repairs.length} server repair(s) required`)
  const untranslatedRepairText =
    /\bconverted to rest|frequency cap reached|recovery\b/.test(text) && scenario.locale === 'de'
  if (untranslatedRepairText) warnings.push('English repair text leaked into German output')

  const score = Math.max(0, 100 - failures.length * 15 - warnings.length * 4 - Math.min(12, repairs.length * 2))
  return {
    score,
    assessment: failures.length ? 'fail' : warnings.length ? 'review' : 'pass',
    failures,
    warnings,
    training_days: trainingDays.length,
    rest_days: restDays,
    quality_days: qualityDays.length,
    used_sports: usedSports,
    endurance_minutes: trainingDays
      .filter((day) => ['running', 'cycling', 'swimming', 'rowing', 'hiking'].includes(day.sport))
      .reduce((sum, day) => sum + day.total_duration_minutes, 0),
    strength_minutes: trainingDays
      .filter((day) => day.sport === 'strength')
      .reduce((sum, day) => sum + day.total_duration_minutes, 0),
    repairs,
  }
}

async function runScenario(scenario: Scenario, model: string, outputDir: string): Promise<Record<string, unknown>> {
  const request = new Request('http://worker.test/api/training-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': `eval-${scenario.id}-${Date.now()}` },
    body: JSON.stringify({
      locale: scenario.locale,
      plan_start_date: startDate,
      coach_style: scenario.coachStyle,
      ...scenario.body,
    }),
  })
  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: model,
    TRAINING_PLAN_MODE: 'local',
    POLAR_SESSIONS: { get: async () => null, put: async () => undefined, delete: async () => undefined },
  } as unknown as Env
  const startedAt = Date.now()
  const response = await createTrainingPlan(request, env)
  const payload = (await response.json()) as WorkerPayload
  if (!response.ok || !payload.plan) throw new Error(payload.detail || `Worker antwortete mit HTTP ${response.status}`)
  const evaluation = evaluate(scenario, payload.plan, payload.meta?.load_budget, payload.meta?.repairs || [])
  const result = {
    scenario: {
      id: scenario.id,
      label: scenario.label,
      rationale: scenario.rationale,
      locale: scenario.locale,
      coach_style: scenario.coachStyle,
    },
    model,
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    input: scenario.body,
    budget: payload.meta?.load_budget,
    evaluation,
    plan: payload.plan,
  }
  await writeFile(resolve(outputDir, `${scenario.id}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  return result
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY fehlt.')
  const selected = options.scenarioIds
    .map((id) => scenarios.find((scenario) => scenario.id === id))
    .filter((scenario): scenario is Scenario => Boolean(scenario))
  if (!selected.length)
    throw new Error(`Keine gültigen Szenarien. Verfügbar: ${scenarios.map((scenario) => scenario.id).join(', ')}`)
  if (selected.length > options.maxCalls)
    throw new Error(`${selected.length} Szenarien überschreiten das Call-Limit ${options.maxCalls}.`)
  await mkdir(options.outputDir, { recursive: true })

  const results: Array<Record<string, unknown>> = []
  for (const scenario of selected) {
    try {
      const result = await runScenario(scenario, options.model, options.outputDir)
      results.push(result)
      const evaluation = result.evaluation as Record<string, unknown>
      console.log(
        `${scenario.id}: ${evaluation.assessment} (${evaluation.score}/100, ${evaluation.training_days} Trainingstage, ${(evaluation.repairs as string[]).length} Reparaturen)`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ scenario: { id: scenario.id, label: scenario.label }, error: message })
      console.error(`${scenario.id}: ERROR — ${message}`)
    }
  }

  const successful = results.filter((result) => result.evaluation)
  const averageScore = successful.length
    ? Math.round(
        (successful.reduce((sum, result) => sum + Number((result.evaluation as Record<string, unknown>).score), 0) /
          successful.length) *
          10,
      ) / 10
    : 0
  const report = {
    generated_at: new Date().toISOString(),
    model: options.model,
    call_count: selected.length,
    average_score: averageScore,
    passed: successful.filter((result) => (result.evaluation as Record<string, unknown>).assessment === 'pass').length,
    reviewed: successful.filter((result) => (result.evaluation as Record<string, unknown>).assessment === 'review')
      .length,
    failed:
      results.length -
      successful.filter((result) => (result.evaluation as Record<string, unknown>).assessment !== 'fail').length,
    results,
  }
  await writeFile(resolve(options.outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(
    `Report: ${resolve(options.outputDir, 'report.json')} (${averageScore}/100 average, ${selected.length} Gemini calls)`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
