import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { workoutDb } from '../db/database'
import type { Workout } from '../types/workout'
import { importWorkoutFiles } from '../services/importService'
import { mergeWorkouts } from '../services/workoutIdentity'
import { toWorkoutSummary, type WorkoutSummary } from '../utils/workoutSummary'
import { plain } from '../utils/clone'
import { useUiStore } from './ui'
import { useI18n } from '../i18n'

export const useWorkoutStore = defineStore('workouts', () => {
  const workouts = ref<Workout[]>([])

  /** List/dashboard projection without GPS tracks. */
  const summaries = computed<WorkoutSummary[]>(() => workouts.value.map(toWorkoutSummary))

  async function loadFromDb() {
    workouts.value = await workoutDb.list()
  }

  async function reloadDeduplicated() {
    workouts.value = await workoutDb.deduplicate()
  }

  async function saveWorkout(workout: Workout) {
    const rpe = workout.sessionRpe
    if (rpe !== undefined && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)) return
    await workoutDb.put(plain(workout))
    workouts.value = await workoutDb.list()
  }

  async function putMany(items: Workout[]) {
    if (!items.length) return
    // Merge by id so connector sync keeps local-only fields (e.g. sessionRpe).
    const existingById = new Map((await workoutDb.list()).map((item) => [item.id, item]))
    const merged = items.map((item) => {
      const previous = existingById.get(item.id)
      return previous ? mergeWorkouts(previous, item) : item
    })
    await workoutDb.putMany(merged.map((item) => plain(item)))
    workouts.value = await workoutDb.list()
  }

  async function importFiles(event: Event) {
    const ui = useUiStore()
    const { t } = useI18n()
    const files = Array.from((event.target as HTMLInputElement).files || [])
    ui.importProgress = { active: files.length > 0, current: 0, total: files.length, fileName: '', failed: 0 }
    const result = await importWorkoutFiles(files, (progress) => {
      ui.importProgress = { ...progress, active: true }
    })
    workouts.value = await workoutDb.list()
    if (result.imported) ui.notify(t.value.importSuccess(result.imported), 'success')
    if (result.failed) ui.notify(t.value.importFailed, 'error')
    ui.importProgress = { ...ui.importProgress, active: false, fileName: '' }
    ;(event.target as HTMLInputElement).value = ''
    return result
  }

  function reset() {
    workouts.value = []
  }

  return {
    workouts,
    summaries,
    loadFromDb,
    reloadDeduplicated,
    saveWorkout,
    putMany,
    importFiles,
    reset,
  }
})
