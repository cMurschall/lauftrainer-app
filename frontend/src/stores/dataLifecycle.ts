import {
  defaultClearDataSelection,
  exportBackup,
  hasClearDataSelection,
  importBackup,
  workoutDb,
  type ClearDataSelection,
} from '../db/database'
import { syncActiveConnectors } from '../services/connectorService'
import { diagnosticLog } from '../services/logger'
import { useI18n } from '../i18n'
import { useUiStore } from './ui'
import { useWorkoutStore } from './workouts'
import { useSettingsStore } from './settings'
import { usePlanStore } from './plan'
import { useAnalysisStore } from './analysis'
import { plain } from '../utils/clone'

export async function downloadBackup() {
  const ui = useUiStore()
  const { t } = useI18n()
  const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `lauftrainer-backup-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(link.href)
  ui.notify(t.value.backupExported, 'success')
}

export async function restoreBackup(event: Event) {
  const ui = useUiStore()
  const workouts = useWorkoutStore()
  const settings = useSettingsStore()
  const plan = usePlanStore()
  const analysis = useAnalysisStore()
  const { t } = useI18n()
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    await importBackup(JSON.parse(await file.text()))
    await workouts.reloadDeduplicated()
    await settings.load()
    await plan.load()
    await analysis.refreshAnalysis()
    ui.notify(t.value.backupRestored, 'success')
  } catch {
    ui.notify(t.value.backupFailed, 'error')
  } finally {
    ;(event.target as HTMLInputElement).value = ''
  }
}

export async function clearLocalData(selection: ClearDataSelection) {
  const ui = useUiStore()
  const workouts = useWorkoutStore()
  const settings = useSettingsStore()
  const plan = usePlanStore()
  const analysis = useAnalysisStore()
  const { t } = useI18n()
  if (!hasClearDataSelection(selection)) {
    ui.notify(t.value.deleteNothingSelected, 'info')
    return false
  }
  if (!window.confirm(t.value.confirmDeleteSelected)) return false
  await workoutDb.clearUserData(selection)
  if (selection.workouts) workouts.reset()
  if (selection.goals) settings.resetGoals()
  if (selection.profile) settings.resetConfig()
  if (selection.plan) plan.reset()
  if (selection.workouts || selection.profile) analysis.reset()
  await analysis.refreshAnalysis()
  ui.notify(t.value.dataDeleted, 'success')
  return true
}

/** Clears every athlete-data category; theme/locale/connectors stay. */
export async function clearAllData() {
  return clearLocalData(defaultClearDataSelection())
}

export async function syncConnectors(options?: { notify?: 'auto' | 'manual' }) {
  const notifyMode = options?.notify ?? 'manual'
  const ui = useUiStore()
  if (ui.connectorLoading) return
  const workouts = useWorkoutStore()
  const settings = useSettingsStore()
  const analysis = useAnalysisStore()
  const { t } = useI18n()
  ui.connectorLoading = true
  try {
    const active = settings.connectors.filter((item) => item.active && item.connected).map((item) => item.id)
    if (!active.length) return
    const syncMode = notifyMode === 'auto' ? 'auto' : 'full'
    const stravaAfter =
      syncMode === 'auto'
        ? [...workouts.summaries]
            .filter((workout) => workout.source === 'strava')
            .map((workout) => workout.date)
            .sort()
            .reverse()[0]
        : undefined
    const results = await syncActiveConnectors(active, { syncMode, stravaAfter })
    const batch = []
    const errors: string[] = []
    let partialSync = false
    for (const result of results) {
      for (const workout of result.workouts) {
        batch.push(plain(workout))
        diagnosticLog('connector.workout', {
          connector: result.connector,
          durationSeconds: workout.durationSeconds,
          distanceKm: workout.distanceKm,
          averageHeartRate: workout.averageHeartRate,
        })
      }
      if (result.error) errors.push(`${result.connector}: ${result.error}`)
      if (result.partial) partialSync = true
    }
    const knownIds = new Set(workouts.workouts.map((workout) => workout.id))
    const freshWorkouts = batch.filter((workout) => !knownIds.has(workout.id))
    const countBefore = workouts.workouts.length
    await workouts.putMany(batch)
    await workouts.reloadDeduplicated()
    await analysis.refreshAnalysis()
    // Dedup can drop a freshly synced workout that already exists under another source id.
    const added = Math.max(0, Math.min(freshWorkouts.length, workouts.workouts.length - countBefore))
    const emptyMetrics = freshWorkouts.filter(
      (workout) => !workout.durationSeconds && !workout.distanceKm,
    ).length
    const shouldNotify = notifyMode === 'manual' || errors.length > 0 || added > 0
    if (shouldNotify) {
      const partialNote = partialSync ? ` ${t.value.syncPartialHint}` : ''
      const summary = added
        ? t.value.syncNewWorkouts(added, batch.length)
        : t.value.syncNoNewWorkouts(batch.length)
      const emptyNote = added && emptyMetrics ? ` ${t.value.syncEmptyMetrics(emptyMetrics)}` : ''
      ui.notify(
        errors.length
          ? `${summary} ${errors.join(' ')}${partialNote}`
          : `${summary}${emptyNote}${partialNote}`,
        errors.length ? 'error' : 'success',
      )
    }
  } catch (error) {
    ui.notify(error instanceof Error ? error.message : t.value.syncFailed, 'error')
  } finally {
    ui.connectorLoading = false
  }
}
