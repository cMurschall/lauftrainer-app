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

export async function syncConnectors() {
  const ui = useUiStore()
  const workouts = useWorkoutStore()
  const settings = useSettingsStore()
  const analysis = useAnalysisStore()
  const { t } = useI18n()
  ui.connectorLoading = true
  try {
    const active = settings.connectors.filter((item) => item.active && item.connected).map((item) => item.id)
    const results = await syncActiveConnectors(active)
    const batch = []
    const errors: string[] = []
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
    }
    await workouts.putMany(batch)
    await workouts.reloadDeduplicated()
    await analysis.refreshAnalysis()
    const emptyMetrics = results.reduce(
      (count, result) =>
        count + result.workouts.filter((workout) => !workout.durationSeconds && !workout.distanceKm).length,
      0,
    )
    ui.notify(
      errors.length
        ? `${batch.length} Training(s) gespeichert. ${errors.join(' ')}`
        : `${batch.length} Training(s) lokal gespeichert.${emptyMetrics ? ` ${emptyMetrics} ohne Dauer oder Distanz.` : ''}`,
      errors.length ? 'error' : 'success',
    )
  } catch (error) {
    ui.notify(error instanceof Error ? error.message : t.value.syncFailed, 'error')
  } finally {
    ui.connectorLoading = false
  }
}
