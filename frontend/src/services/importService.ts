import type { Workout } from '../types/workout'
import { parsePolarCsv } from '../parsers/csv'
import { parsePolarJson } from '../parsers/json'
import { parseTcx } from '../parsers/tcx'
import { parseGpx } from '../parsers/gpx'
import { parseFit } from '../parsers/fit'
import { workoutDb } from '../db/database'
import { diagnosticLog } from './logger'
import { mergeWorkouts, workoutIdentity } from './workoutIdentity'

async function parseWorkoutFile(file: File): Promise<Workout> {
  const extension = file.name.toLowerCase().split('.').pop()
  diagnosticLog('import.start', { fileName: file.name, extension })
  let workout: Workout
  if (extension === 'fit') workout = parseFit(await file.arrayBuffer(), file.name)
  else {
    const text = await file.text()
    if (extension === 'csv') workout = parsePolarCsv(text, file.name)
    else if (extension === 'json') workout = parsePolarJson(text, file.name)
    else if (extension === 'tcx') workout = parseTcx(text, file.name)
    else if (extension === 'gpx') workout = parseGpx(text, file.name)
    else throw new Error(`${file.name}: .${extension || 'unbekannt'} wird noch nicht unterstützt.`)
  }
  workout.sourceFileHash = await hashFile(file)
  return workout
}

function resolveImportedWorkout(workout: Workout, fileName: string, existingByIdentity: Map<string, Workout>) {
  const identity = workoutIdentity({ id: fileName, name: fileName })
  const existing = existingByIdentity.get(identity)
  workout.id = identity === fileName ? `${workout.source}-${workout.sourceFileHash}` : identity
  const merged = existing ? { ...mergeWorkouts(existing, workout), id: workout.id } : workout
  const staleId = existing && existing.id !== workout.id ? existing.id : undefined
  existingByIdentity.set(identity, merged)
  existingByIdentity.set(workoutIdentity(merged), merged)
  return { merged, staleId }
}

/** Parse + persist a single file (used by tests and one-off imports). */
export async function importWorkoutFile(file: File): Promise<Workout> {
  const workout = await parseWorkoutFile(file)
  const existingList = await workoutDb.list()
  const existingByIdentity = new Map(existingList.map((item) => [workoutIdentity(item), item]))
  const { merged, staleId } = resolveImportedWorkout(workout, file.name, existingByIdentity)
  if (staleId) await workoutDb.delete(staleId)
  await workoutDb.put(merged)
  diagnosticLog('import.success', {
    fileName: file.name,
    source: workout.source,
    durationSeconds: workout.durationSeconds,
    distanceKm: workout.distanceKm,
    recordCount: workout.records.length,
  })
  return merged
}

export interface BatchImportProgress {
  current: number
  total: number
  fileName: string
  failed: number
}

/** Parse all files, then write winners in one IndexedDB batch. */
export async function importWorkoutFiles(
  files: File[],
  onProgress?: (progress: BatchImportProgress) => void,
): Promise<{ imported: number; failed: number; workouts: Workout[] }> {
  const existingList = await workoutDb.list()
  const existingByIdentity = new Map(existingList.map((item) => [workoutIdentity(item), item]))
  const winners = new Map<string, Workout>()
  const staleIds = new Set<string>()
  let imported = 0
  let failed = 0

  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    onProgress?.({ current: index, total: files.length, fileName: file.name, failed })
    try {
      const workout = await parseWorkoutFile(file)
      const { merged, staleId } = resolveImportedWorkout(workout, file.name, existingByIdentity)
      if (staleId) staleIds.add(staleId)
      winners.set(merged.id, merged)
      imported++
      diagnosticLog('import.success', {
        fileName: file.name,
        source: workout.source,
        durationSeconds: workout.durationSeconds,
        distanceKm: workout.distanceKm,
        recordCount: workout.records.length,
      })
    } catch (error) {
      failed++
      diagnosticLog('import.error', {
        fileName: file.name,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    onProgress?.({ current: index + 1, total: files.length, fileName: file.name, failed })
  }

  const batch = [...winners.values()]
  if (batch.length) await workoutDb.putMany(batch)
  const deleteIds = [...staleIds].filter((id) => !winners.has(id))
  if (deleteIds.length) await workoutDb.deleteMany(deleteIds)
  return { imported, failed, workouts: batch }
}

async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
