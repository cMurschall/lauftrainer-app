import { z } from 'zod'
import type { Env } from './types'
import { json } from './http'
import { finishReservation, reserveCredit } from './billing'

const requestSchema = z.object({
  locale: z.enum(['de', 'en']).default('de'),
  profile: z.record(z.unknown()).default({}),
  goals: z.array(z.record(z.unknown())).max(20).default([]),
  metrics: z.record(z.unknown()).default({}),
  recent_workouts: z.array(z.record(z.unknown())).max(21).default([]),
  config: z.record(z.unknown()).optional(),
  workouts: z.array(z.record(z.unknown())).max(14).optional(),
})
const stepSchema = z.object({ step_duration: z.string().min(1), step_intensity: z.string().min(1), step_instruction: z.string().min(1) })
const daySchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
  sport: z.enum(['running', 'cycling', 'swimming', 'rowing', 'hiking', 'strength', 'mobility', 'other']),
  session_type: z.enum(['training', 'rest']),
  title: z.string().min(1),
  description: z.string().min(1),
  target_focus: z.string().min(1),
  total_duration_minutes: z.number().int().nonnegative(),
  workout_steps: z.array(stepSchema).min(1),
})
const weekSummarySchema = z.object({ focus_title: z.string().min(1), goal_description: z.string().min(1) })
const planSchema = z.object({ week_summary: weekSummarySchema, days: z.array(daySchema).length(7) })

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
          day: { type: 'STRING', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
          sport: { type: 'STRING', enum: ['running', 'cycling', 'swimming', 'rowing', 'hiking', 'strength', 'mobility', 'other'] },
          session_type: { type: 'STRING', enum: ['training', 'rest'] }, title: { type: 'STRING' }, description: { type: 'STRING' }, target_focus: { type: 'STRING' },
          total_duration_minutes: { type: 'INTEGER' },
          workout_steps: { type: 'ARRAY', items: { type: 'OBJECT', properties: { step_duration: { type: 'STRING' }, step_intensity: { type: 'STRING' }, step_instruction: { type: 'STRING' } }, required: ['step_duration', 'step_intensity', 'step_instruction'] } },
        },
        required: ['day', 'sport', 'session_type', 'title', 'description', 'target_focus', 'total_duration_minutes', 'workout_steps'],
      },
    },
  },
  required: ['week_summary', 'days'],
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
  if (env.TRAINING_PLAN_MODE === 'mock' || (env.TRAINING_PLAN_MODE === 'local' && !env.GEMINI_API_KEY) || !env.GEMINI_API_KEY) {
    const plan = createDebugPlan(parsed.data.locale)
    if (reservation.reservationId) await finishReservation(env, reservation.reservationId, plan, true)
    return json({ plan, debug: true, detail: 'Lokaler Mock-Trainingsplan.' }, 200, request, env)
  }
  const prompt = createPromptEnglish(parsed.data)
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash'
  let response: Response
  try { response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.2 } }),
    signal: AbortSignal.timeout(45_000),
  }) } catch (error) {
    await releaseReservation()
    return json({ detail: 'Gemini ist momentan nicht erreichbar.' }, 502, request, env)
  }
  if (!response.ok) { await releaseReservation(); return json({ detail: `Gemini antwortete mit ${response.status}.` }, 502, request, env) }
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')
  if (!text) {
    await releaseReservation()
    return json({ detail: 'Gemini lieferte keine verwertbare Antwort.' }, 502, request, env)
  }
  let plan: z.infer<typeof planSchema>
  try { plan = planSchema.parse(normalizePlan(parseJson(text))) } catch (error) { await releaseReservation(); throw error }
  if (reservation.reservationId) await finishReservation(env, reservation.reservationId, plan, true)
  return json({ plan }, 200, request, env)
}

function normalizePlan(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const plan = value as Record<string, unknown>
  if (!Array.isArray(plan.days)) return value
  return {
    ...plan,
    days: plan.days.map((day) => {
      if (!day || typeof day !== 'object' || Array.isArray(day)) return day
      const item = day as Record<string, unknown>
      return {
        ...item,
        sport: normalizeSport(item.sport),
        session_type: normalizeSessionType(item.session_type),
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
    row: 'rowing', rowing: 'rowing',
    hike: 'hiking', hiking: 'hiking', walk: 'hiking', walking: 'hiking',
    strength: 'strength', mobility: 'mobility', rest: 'other', recovery: 'other', other: 'other',
  }
  return aliases[sport] || sport
}

function normalizeSessionType(value: unknown): string {
  const sessionType = String(value ?? '').trim().toLowerCase()
  if (['rest', 'recovery', 'rest day', 'recovery day'].includes(sessionType)) return 'rest'
  return 'training'
}

function createDebugPlan(locale: 'de' | 'en'): z.infer<typeof planSchema> {
  const english = locale === 'en'
  const days = english
    ? [
        ['Monday', 'Rest', 'TEST PLAN — no Gemini key configured.', 'Recovery'],
        ['Tuesday', 'Running', 'TEST PLAN — easy aerobic run.', 'Base endurance'],
        ['Wednesday', 'Rest', 'TEST PLAN — recovery day.', 'Recovery'],
        ['Thursday', 'Running', 'TEST PLAN — controlled interval session.', 'Speed'],
        ['Friday', 'Rest', 'TEST PLAN — recovery day.', 'Recovery'],
        ['Saturday', 'Running', 'TEST PLAN — relaxed long run.', 'Endurance'],
        ['Sunday', 'Walking', 'TEST PLAN — easy active recovery.', 'Recovery'],
      ]
    : [
        ['Montag', 'Rest', 'TESTPLAN — Gemini-Key ist nicht konfiguriert.', 'Erholung'],
        ['Dienstag', 'Running', 'TESTPLAN — lockerer aerober Lauf.', 'Grundlagenausdauer'],
        ['Mittwoch', 'Rest', 'TESTPLAN — Erholungstag.', 'Erholung'],
        ['Donnerstag', 'Running', 'TESTPLAN — kontrollierte Intervalleinheit.', 'Schnelligkeit'],
        ['Freitag', 'Rest', 'TESTPLAN — Erholungstag.', 'Erholung'],
        ['Samstag', 'Running', 'TESTPLAN — entspannter langer Lauf.', 'Ausdauer'],
        ['Sonntag', 'Walking', 'TESTPLAN — lockere aktive Erholung.', 'Erholung'],
      ]
  const variants = [
    [0, 35, 0, 40, 0, 55, 25],
    [0, 30, 35, 0, 45, 60, 20],
    [25, 0, 40, 0, 35, 70, 0],
  ]
  const durations = variants[Math.floor(Math.random() * variants.length)]
  const summaries = english
    ? [
        { focus_title: 'Aerobic base and recovery', goal_description: 'Build consistent endurance while allowing recovery between demanding sessions.' },
        { focus_title: 'Controlled progression', goal_description: 'Increase training stimulus gradually without sacrificing recovery quality.' },
        { focus_title: 'Endurance with strategic intensity', goal_description: 'Combine easy volume with one focused quality session and enough recovery.' },
      ]
    : [
        { focus_title: 'Aerobe Basis und Erholung', goal_description: 'Baue deine Ausdauer kontinuierlich auf und lasse zwischen fordernden Einheiten bewusst Erholung zu.' },
        { focus_title: 'Kontrollierte Steigerung', goal_description: 'Erhöhe den Trainingsreiz schrittweise, ohne die Qualität der Erholung zu beeinträchtigen.' },
        { focus_title: 'Ausdauer mit gezielter Intensität', goal_description: 'Verbinde lockeren Umfang mit einer fokussierten Qualitätseinheit und ausreichend Erholung.' },
      ]
  const summary = summaries[Math.floor(Math.random() * summaries.length)]
  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  return planSchema.parse({
    week_summary: summary,
    days: days.map(([, sport, description, focus], index) => ({
    day: dayKeys[index],
    sport: sport.toLowerCase() === 'walking' ? 'hiking' : sport.toLowerCase() === 'rest' ? 'other' : sport.toLowerCase(),
    session_type: sport.toLowerCase() === 'rest' ? 'rest' : 'training',
    title: focus,
    description,
    target_focus: focus,
    total_duration_minutes: durations[index],
    workout_steps: [{
      step_duration: durations[index] ? `${durations[index]} min` : 'Ruhetag',
      step_intensity: durations[index] ? 'Locker' : 'Erholung',
      step_instruction: description,
    }],
    })),
  })
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  try { return JSON.parse(trimmed) } catch {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]
    if (fenced) return JSON.parse(fenced)
    const start = trimmed.indexOf('['), end = trimmed.lastIndexOf(']')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('Gemini lieferte kein gültiges JSON-Array.')
  }
}

function createPromptEnglish(data: z.infer<typeof requestSchema>): string {
  const outputLanguage = data.locale === 'de' ? 'German' : 'English'
  const instructions = [
    'You are a professional endurance training coach.',
    'Create a safe and realistic 7-day training plan.',
    `OUTPUT_LANGUAGE: ${outputLanguage}. Write all human-readable text in this language.`,
    'Keep all JSON property names and enum values exactly as defined in the schema; do not translate them.',
    'Return a JSON object with week_summary and days, never a bare array.',
    'week_summary must contain a personalized focus_title and goal_description explaining why this week is structured this way.',
    'Use measured local metrics as the primary basis for load decisions.',
    'Treat profile.available_sports as a strict whitelist. Never schedule a sport that is not listed there.',
    'Use only sports from the available_sports whitelist, including rowing, strength, or mobility only when explicitly enabled.',
    'Respect profile, goals, preferred days, and all weekly/daily limits.',
    'Manage load conservatively using CTL, ATL, TSB, and ACWR. Schedule recovery when fatigue or risk signals are present.',
    'Create exactly one actionable TODO for each of seven days, including rest days.',
    'Use heart-rate zones only when they are provided.',
    'All step_duration, step_intensity, and step_instruction values must be JSON strings.',
    'Unknown personal information stays unknown. Do not invent it.',
    'Return only valid JSON without Markdown.',
  ]
  const schema = 'JSON schema: week_summary has focus_title and goal_description; days is an array of exactly seven objects. Each day needs day, sport, session_type, title, description, target_focus, total_duration_minutes, and workout_steps. Each step needs step_duration, step_intensity, and step_instruction.'
  return [...instructions, schema, '', 'USER_PROFILE:', JSON.stringify(data.profile), 'GOALS:', JSON.stringify(data.goals), 'MEASURED_METRICS:', JSON.stringify(data.metrics), 'RECENT_WORKOUTS:', JSON.stringify(data.recent_workouts || data.workouts || [])].join('\n')
}

function createPromptV2(data: z.infer<typeof requestSchema>): string {
  const english = data.locale === 'en'
  const instructions = english
    ? ['Create a safe and realistic 7-day training plan.', 'Answer exclusively in English.', 'Return a JSON object with week_summary and days, never a bare array.', 'week_summary must contain a personalized focus_title and goal_description explaining why this week is structured this way.', 'Use measured local metrics as the primary basis for load decisions.', 'Treat profile.available_sports as a strict whitelist: never schedule cycling, climbing, swimming, or any other sport that is not listed there.', 'Only include climbing when the athlete explicitly has climbing in available_sports or requests it as a goal.', 'Respect profile, goals, preferred days, and all weekly/daily limits.', 'Manage load conservatively using CTL, ATL, TSB, and ACWR. Schedule recovery when fatigue or risk signals are present.', 'Create exactly one actionable TODO for each of seven days, including rest days.', 'Use only available sports and use HR zones only when provided.', 'All step_duration, step_intensity, and step_instruction values must be JSON strings.', 'Unknown personal information stays unknown. Do not invent it.']
    : ['Erstelle einen sicheren und realistischen 7-Tage-Trainingsplan.', 'Antworte ausschließlich auf Deutsch.', 'Gib ein JSON-Objekt mit week_summary und days zurück, niemals ein reines Array.', 'week_summary muss einen personalisierten focus_title und eine goal_description enthalten, die erklären, warum diese Woche so aufgebaut ist.', 'Nutze die lokal gemessenen Kennzahlen als wichtigste Grundlage für die Belastung.', 'Behandle profile.available_sports als strikte Whitelist: Plane niemals Radfahren, Klettern, Schwimmen oder eine andere Sportart ein, die dort nicht enthalten ist.', 'Plane Klettern nur ein, wenn der Athlet Klettern ausdrücklich als verfügbare Sportart oder Ziel angegeben hat.', 'Beachte Ziele, bevorzugte Tage sowie Wochen- und Tageslimits.', 'Steuere konservativ anhand von CTL, ATL, TSB und ACWR. Plane bei Ermüdung oder Risiko Erholung.', 'Erstelle für jeden der sieben Tage genau eine TODO, einschließlich Ruhetagen.', 'Nutze Herzfrequenzzonen nur, wenn sie angegeben sind.', 'Alle Werte von step_duration, step_intensity und step_instruction müssen JSON-Strings sein.', 'Unbekannte persönliche Angaben bleiben unbekannt. Erfinde sie nicht.']
  const schema = english
    ? 'JSON schema: week_summary has focus_title and goal_description; days is an array of exactly seven objects. Each day needs day, sport, description, target_focus, total_duration_minutes, and workout_steps. Each step needs step_duration, step_intensity, and step_instruction.'
    : 'JSON-Schema: week_summary enthält focus_title und goal_description; days ist ein Array mit genau sieben Objekten. Jeder Tag benötigt day, sport, description, target_focus, total_duration_minutes und workout_steps. Jeder Schritt benötigt step_duration, step_intensity und step_instruction.'
  return [...instructions, schema, 'Return only valid JSON without Markdown.', '', 'USER_PROFILE:', JSON.stringify(data.profile), 'GOALS:', JSON.stringify(data.goals), 'MEASURED_METRICS:', JSON.stringify(data.metrics), 'RECENT_WORKOUTS:', JSON.stringify(data.recent_workouts || data.workouts || [])].join('\n')
}

function createPrompt(data: z.infer<typeof requestSchema>): string {
  const english = data.locale === 'en'
  const rules = english
    ? ['Use measured local metrics as the primary basis for load decisions.', 'Respect profile, goals, available sports, preferred days, and all weekly/daily limits.', 'Manage load conservatively using CTL, ATL, TSB, and ACWR. Schedule recovery when fatigue or risk signals are present.', 'Create exactly one actionable TODO for each of seven days, including rest days.', 'Use only available sports and use HR zones only when provided.', 'All step_duration, step_intensity, and step_instruction values must be JSON strings. Never use a number for step_duration.', 'Return only a JSON array with exactly seven objects, without Markdown.']
    : ['Nutze die lokal gemessenen Kennzahlen als wichtigste Grundlage für die Belastung.', 'Beachte Profil, Ziele, verfügbare Sportarten, bevorzugte Tage sowie Wochen- und Tageslimits.', 'Steuere konservativ anhand von CTL, ATL, TSB und ACWR. Plane bei Ermüdung oder Risiko Erholung.', 'Erstelle für jeden der sieben Tage genau eine TODO, einschließlich Ruhetagen.', 'Nutze nur verfügbare Sportarten und Herzfrequenzzonen nur, wenn sie angegeben sind.', 'Alle Werte von step_duration, step_intensity und step_instruction müssen JSON-Strings sein. Verwende niemals eine Zahl für step_duration.', 'Gib ausschließlich ein JSON-Array mit genau sieben Objekten ohne Markdown zurück.']
  const schema = english ? 'Each object needs day, sport, description, target_focus, total_duration_minutes, and workout_steps. Each workout_steps item needs the three string fields step_duration, step_intensity, and step_instruction.' : 'Jedes Objekt benötigt day, sport, description, target_focus, total_duration_minutes und workout_steps. Jeder Schritt benötigt die drei String-Felder step_duration, step_intensity und step_instruction.'
  return [english ? 'Create a safe and realistic 7-day training plan.' : 'Erstelle einen sicheren und realistischen 7-Tage-Trainingsplan.', english ? 'Answer exclusively in English.' : 'Antworte ausschließlich auf Deutsch.', english ? 'Unknown personal information stays unknown. Do not invent it.' : 'Unbekannte persönliche Angaben bleiben unbekannt. Erfinde sie nicht.', ...rules, schema, '', 'USER_PROFILE:', JSON.stringify(data.profile), 'GOALS:', JSON.stringify(data.goals), 'MEASURED_METRICS:', JSON.stringify(data.metrics), 'RECENT_WORKOUTS:', JSON.stringify(data.recent_workouts || data.workouts || [])].join('\n')
}

async function legacyCreateTrainingPlan(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) return json({ detail: 'GEMINI_API_KEY ist nicht konfiguriert.' }, 503, request, env)
  const rawBody = await request.text()
  if (rawBody.length > 128 * 1024) return json({ detail: 'Request ist zu groß.' }, 413, request, env)
  let body: unknown
  try { body = JSON.parse(rawBody) } catch { return json({ detail: 'Ungültiges JSON.' }, 400, request, env) }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return json({ detail: 'Ungültige Trainingsdaten.', issues: parsed.error.issues }, 400, request, env)
  const prompt = ['Erstelle einen sicheren, realistischen 7-Tage-Lauftrainingsplan.', 'Nutze ausschließlich die angegebenen Herzfrequenzzonen.', 'Gib ausschließlich ein JSON-Array zurück, ohne Markdown oder zusätzliche Erklärung.', '', `ATHLET: ${JSON.stringify(parsed.data.config)}`, `TRAININGSHISTORIE: ${JSON.stringify(parsed.data.workouts)}`].join('\n')
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash'
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{responseMimeType:'application/json'} }), signal:AbortSignal.timeout(45_000) })
  if (!response.ok) return json({ detail: `Gemini antwortete mit ${response.status}.` }, 502, request, env)
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini lieferte keinen Text zurück.')
  const plan = z.array(daySchema).min(1).parse(JSON.parse(text))
  return json({ plan }, 200, request, env)
}
