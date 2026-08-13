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
const daySchema = z.object({ day: z.string().min(1), sport: z.string().min(1), description: z.string().min(1), target_focus: z.string().min(1), total_duration_minutes: z.number().int().nonnegative(), workout_steps: z.array(stepSchema).min(1) })
const planSchema = z.array(daySchema).length(7)

const responseSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      day: { type: 'STRING' }, sport: { type: 'STRING' }, description: { type: 'STRING' }, target_focus: { type: 'STRING' },
      total_duration_minutes: { type: 'INTEGER' },
      workout_steps: { type: 'ARRAY', items: { type: 'OBJECT', properties: { step_duration: { type: 'STRING' }, step_intensity: { type: 'STRING' }, step_instruction: { type: 'STRING' } }, required: ['step_duration', 'step_intensity', 'step_instruction'] } },
    },
    required: ['day', 'sport', 'description', 'target_focus', 'total_duration_minutes', 'workout_steps'],
  },
}

export async function createTrainingPlan(request: Request, env: Env): Promise<Response> {
  const requestId = request.headers.get('X-Idempotency-Key')?.trim()
  if (!requestId || requestId.length > 128) return json({ detail: 'X-Idempotency-Key fehlt oder ist ungültig.' }, 400, request, env)
  const reservation = await reserveCredit(request, env, requestId)
  if (reservation.error) return reservation.error
  if (reservation.replay) return reservation.replay.result_json ? json({ plan: JSON.parse(reservation.replay.result_json), replay: true }, 200, request, env) : json({ detail: 'Diese Anfrage wird bereits verarbeitet.' }, 409, request, env)
  if (!env.GEMINI_API_KEY) { await finishReservation(env, reservation.reservationId!, null, false); return json({ detail: 'GEMINI_API_KEY ist nicht konfiguriert.' }, 503, request, env) }
  const rawBody = await request.text()
  if (rawBody.length > 128 * 1024) return json({ detail: 'Request ist zu groß.' }, 413, request, env)
  let body: unknown
  try { body = JSON.parse(rawBody) } catch { return json({ detail: 'Ungültiges JSON.' }, 400, request, env) }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return json({ detail: 'Ungültige Trainingsdaten.', issues: parsed.error.issues }, 400, request, env)
  const prompt = createPrompt(parsed.data)
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash'
  let response: Response
  try { response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.2 } }),
    signal: AbortSignal.timeout(45_000),
  }) } catch (error) { await finishReservation(env, reservation.reservationId!, null, false); throw error }
  if (!response.ok) { await finishReservation(env, reservation.reservationId!, null, false); return json({ detail: `Gemini antwortete mit ${response.status}.` }, 502, request, env) }
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')
  if (!text) throw new Error('Gemini lieferte keinen Text zurück.')
  let plan: z.infer<typeof planSchema>
  try { plan = planSchema.parse(parseJson(text)) } catch (error) { await finishReservation(env, reservation.reservationId!, null, false); throw error }
  await finishReservation(env, reservation.reservationId!, plan, true)
  return json({ plan }, 200, request, env)
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
