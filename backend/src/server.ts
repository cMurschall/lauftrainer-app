import cors from 'cors'
import 'dotenv/config'
import express, { type ErrorRequestHandler } from 'express'
import { z } from 'zod'

const port = Number(process.env.PORT || 8000)
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const app = express()

const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'http://localhost:5173')
  .split(',').map(origin => origin.trim()).filter(Boolean)

app.use(cors({ origin: allowedOrigins }))
app.use(express.json({ limit: '128kb' }))

const trainingRequestSchema = z.object({
  config: z.record(z.unknown()),
  workouts: z.array(z.record(z.unknown())).max(14).default([])
})

const trainingStepSchema = z.object({
  step_duration: z.string(),
  step_intensity: z.string(),
  step_instruction: z.string()
})

const trainingDaySchema = z.object({
  day: z.string(),
  sport: z.string(),
  description: z.string(),
  target_focus: z.string(),
  total_duration_minutes: z.number().int().nonnegative(),
  workout_steps: z.array(trainingStepSchema)
})

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.post('/api/training-plan', async (request, response, next) => {
  try {
    const parsedRequest = trainingRequestSchema.safeParse(request.body)
    if (!parsedRequest.success) {
      response.status(400).json({ detail: 'Ungültige Trainingsdaten.', issues: parsedRequest.error.issues })
      return
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      response.status(503).json({ detail: 'GEMINI_API_KEY ist nicht konfiguriert.' })
      return
    }

    const prompt = [
      'Erstelle einen sicheren, realistischen 7-Tage-Lauftrainingsplan.',
      'Nutze ausschließlich die angegebenen Herzfrequenzzonen.',
      'Gib ausschließlich ein JSON-Array zurück, ohne Markdown oder zusätzliche Erklärung.',
      '',
      `ATHLET: ${JSON.stringify(parsedRequest.data.config)}`,
      `TRAININGSHISTORIE: ${JSON.stringify(parsedRequest.data.workouts)}`
    ].join('\n')

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        }),
        signal: AbortSignal.timeout(45_000)
      }
    )

    if (!geminiResponse.ok) {
      const detail = await geminiResponse.text()
      response.status(502).json({ detail: `Gemini antwortete mit ${geminiResponse.status}.`, provider: detail.slice(0, 500) })
      return
    }

    const payload = await geminiResponse.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('Gemini lieferte keinen Text zurück.')

    const rawPlan: unknown = JSON.parse(text)
    const plan = z.array(trainingDaySchema).min(1).parse(rawPlan)
    response.json({ plan })
  } catch (error) {
    next(error)
  }
})

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error('Backend error:', error)
  response.status(502).json({ detail: 'KI-Aufruf konnte nicht verarbeitet werden.' })
}
app.use(errorHandler)

app.listen(port, () => console.log(`LaufTrainer backend listening on port ${port}`))
