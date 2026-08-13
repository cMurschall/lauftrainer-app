import type { Workout } from '../types/workout'
import { parsePolarCsv } from '../parsers/csv'
import { parsePolarJson } from '../parsers/json'
import { parseTcx } from '../parsers/tcx'
import { parseGpx } from '../parsers/gpx'
import { parseFit } from '../parsers/fit'
import { workoutDb } from '../db/database'

export async function importWorkoutFile(file: File): Promise<Workout> {
  const extension = file.name.toLowerCase().split('.').pop()
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
  workout.id = `${workout.source}-${workout.sourceFileHash}`
  await workoutDb.put(workout)
  return workout
}

async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
