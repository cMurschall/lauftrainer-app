export interface DiagnosticEntry {
  timestamp: string
  event: string
  details: Record<string, unknown>
}

const STORAGE_KEY = 'lauftrainer-diagnostics'
const MAX_ENTRIES = 200

function readEntries(): DiagnosticEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export function diagnosticLog(event: string, details: Record<string, unknown> = {}) {
  const entry = { timestamp: new Date().toISOString(), event, details }
  console.info(`[LaufTrainer] ${event}`, details)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...readEntries(), entry].slice(-MAX_ENTRIES)))
  } catch {
    // Diagnostics must never break importing or analysis.
  }
}

export function getDiagnosticLogs(): DiagnosticEntry[] {
  return readEntries()
}

export function clearDiagnosticLogs() {
  localStorage.removeItem(STORAGE_KEY)
}
