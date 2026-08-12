import { z } from 'zod'
import type { Env } from './types'
import { json } from './http'

const requestSchema = z.object({ config: z.record(z.unknown()), workouts: z.array(z.record(z.unknown())).max(14).default([]) })
const stepSchema = z.object({ step_duration: z.string(), step_intensity: z.string(), step_instruction: z.string() })
const daySchema = z.object({ day: z.string(), sport: z.string(), description: z.string(), target_focus: z.string(), total_duration_minutes: z.number().int().nonnegative(), workout_steps: z.array(stepSchema) })

export async function createTrainingPlan(request: Request, env: Env): Promise<Response> {
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
