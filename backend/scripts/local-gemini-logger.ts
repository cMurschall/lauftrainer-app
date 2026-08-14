import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

const host = '127.0.0.1'
const port = 8790
const outputDirectory = resolve(process.cwd(), 'output', 'gemini')
const maxBodyBytes = 2 * 1024 * 1024

await mkdir(outputDirectory, { recursive: true })

const server = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/gemini-log') {
    response.writeHead(404).end()
    return
  }

  const chunks: Buffer[] = []
  let bodyBytes = 0
  request.on('data', (chunk: Buffer) => {
    bodyBytes += chunk.length
    if (bodyBytes > maxBodyBytes) request.destroy(new Error('Log-Eintrag ist zu groß.'))
    else chunks.push(chunk)
  })
  request.on('end', async () => {
    try {
      const entry = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        request?: { requestId?: string }
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const requestId = String(entry.request?.requestId || 'request').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
      const filename = `${timestamp}-${requestId}-${randomUUID().slice(0, 8)}.json`
      await writeFile(resolve(outputDirectory, filename), `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
      response.writeHead(204).end()
      console.log(`Gemini-Log gespeichert: output/gemini/${filename}`)
    } catch (error) {
      console.error('Gemini-Log konnte nicht gespeichert werden:', error)
      response.writeHead(400).end()
    }
  })
})

server.listen(port, host, () => {
  console.log(`Lokales Gemini-Logging aktiv: ${outputDirectory}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
