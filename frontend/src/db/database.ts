import type { AnalysisSummary, TrainingPlan, TrainingPlanHistoryEntry, UserConfig, Workout } from '../types/workout'
import type { AppSettings, TrainingGoal } from '../types/settings'
import { mergeWorkouts, workoutIdentity } from '../services/workoutIdentity'
import { diagnosticLog } from '../services/logger'

const DB_NAME = 'lauftrainer-local'
const DB_VERSION = 6

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      diagnosticLog('db.upgrade', { name: DB_NAME, version: DB_VERSION, oldVersion: event.oldVersion })
      const db = request.result
      if (!db.objectStoreNames.contains('workouts')) db.createObjectStore('workouts', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
      if (!db.objectStoreNames.contains('plans')) db.createObjectStore('plans', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('planHistory')) db.createObjectStore('planHistory', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('analysisCache')) db.createObjectStore('analysisCache', { keyPath: 'cacheKey' })
      if (!db.objectStoreNames.contains('goals')) db.createObjectStore('goals', { keyPath: 'id' })
    }
    request.onsuccess = () => {
      diagnosticLog('db.open.success', { name: DB_NAME, version: request.result.version, stores: [...request.result.objectStoreNames] })
      resolve(request.result)
    }
    request.onerror = () => {
      diagnosticLog('db.open.error', { name: DB_NAME, error: request.error?.message || String(request.error) })
      reject(request.error)
    }
  })
}

async function transaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const dbTransaction = db.transaction(storeName, mode)
    const transactionId = crypto.randomUUID()
    diagnosticLog('db.transaction.start', { transactionId, storeName, mode })
    let result: T
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      diagnosticLog('db.transaction.error', {
        transactionId,
        storeName,
        mode,
        error: error instanceof Error ? error.message : String(error),
      })
      db.close()
      reject(error)
    }

    let request: IDBRequest
    try {
      request = action(dbTransaction.objectStore(storeName))
    } catch (error) {
      fail(error)
      return
    }

    request.onsuccess = () => {
      result = request.result as T
      diagnosticLog('db.request.success', { transactionId, storeName, mode, resultType: typeof result })
    }
    request.onerror = () => fail(request.error)
    dbTransaction.onerror = () => fail(dbTransaction.error)
    dbTransaction.onabort = () => fail(dbTransaction.error || new Error('IndexedDB transaction aborted'))
    // Resolve only after IndexedDB has committed the complete transaction.
    dbTransaction.oncomplete = () => {
      if (settled) return
      settled = true
      diagnosticLog('db.transaction.complete', { transactionId, storeName, mode })
      db.close()
      resolve(result)
    }
  })
}

export const workoutDb = {
  list: async () => (await transaction<Workout[]>('workouts', 'readonly', (store) => store.getAll())).map((workout) => ({ ...workout, rawSport: workout.rawSport ?? workout.sport })),
  put: async (workout: Workout) => {
    const result = await transaction<IDBValidKey>('workouts', 'readwrite', (store) => store.put(workout))
    await workoutDb.bumpWorkoutRevision()
    return result
  },
  deleteAll: async () => {
    const result = await transaction<undefined>('workouts', 'readwrite', (store) => store.clear())
    await workoutDb.bumpWorkoutRevision()
    return result
  },
  deleteAllGoals: () => transaction<undefined>('goals', 'readwrite', (store) => store.clear()),
  delete: (id: string) => transaction<undefined>('workouts', 'readwrite', (store) => store.delete(id)),
  deduplicate: async () => {
    const all = await workoutDb.list()
    const grouped = new Map<string, Workout>()
    for (const workout of all) {
      const key = workoutIdentity(workout)
      const existing = grouped.get(key)
      grouped.set(key, existing ? mergeWorkouts(existing, workout) : workout)
    }
    if (grouped.size === all.length) return all
    const winnerIds = new Set([...grouped.values()].map((workout) => workout.id))
    await transaction<undefined>('workouts', 'readwrite', (store) => {
      for (const workout of grouped.values()) store.put(workout)
      for (const workout of all) if (!winnerIds.has(workout.id)) store.delete(workout.id)
      return store.getAll() as unknown as IDBRequest<undefined>
    })
    await workoutDb.bumpWorkoutRevision()
    return workoutDb.list()
  },
  getConfig: () => transaction<UserConfig | undefined>('settings', 'readonly', (store) => store.get('config')),
  saveConfig: async (config: UserConfig) => {
    const previous = await workoutDb.getConfig()
    const result = await transaction<IDBValidKey>('settings', 'readwrite', (store) => store.put(config, 'config'))
    if (JSON.stringify(analysisConfig(previous)) !== JSON.stringify(analysisConfig(config)))
      await workoutDb.bumpWorkoutRevision()
    return result
  },
  getAppSettings: () => transaction<AppSettings | undefined>('settings', 'readonly', (store) => store.get('app')),
  saveAppSettings: (settings: AppSettings) =>
    transaction<IDBValidKey>('settings', 'readwrite', (store) => store.put(settings, 'app')),
  listGoals: () => transaction<TrainingGoal[]>('goals', 'readonly', (store) => store.getAll()),
  saveGoal: (goal: TrainingGoal) => transaction<IDBValidKey>('goals', 'readwrite', (store) => store.put(goal)),
  deleteGoal: (id: string) => transaction<undefined>('goals', 'readwrite', (store) => store.delete(id)),
  savePlan: (plan: TrainingPlan) =>
    (async () => {
      const previous = await workoutDb.getPlan()
      if (previous?.plan) {
        await workoutDb.savePlanHistory({
          id: `plan-${Date.now()}-${crypto.randomUUID()}`,
          createdAt: previous.createdAt || new Date().toISOString(),
          plan: previous.plan,
          completedDays: previous.completedDays,
        })
      }
      return transaction<IDBValidKey>('plans', 'readwrite', (store) =>
        store.put({ id: 'current', createdAt: new Date().toISOString(), plan }),
      )
    })(),
  getPlan: async () => {
    return await transaction<{ plan?: TrainingPlan; completedDays?: string[]; createdAt?: string } | undefined>('plans', 'readonly', (store) => store.get('current'))
  },
  savePlanWithStatus: (plan: TrainingPlan, completedDays: string[]) =>
    transaction<IDBValidKey>('plans', 'readwrite', (store) =>
      store.put({
        id: 'current',
        createdAt: new Date().toISOString(),
        plan,
        completedDays,
      }),
    ),
  savePlanHistory: (entry: TrainingPlanHistoryEntry) =>
    transaction<IDBValidKey>('planHistory', 'readwrite', (store) => store.put(entry)),
  listPlanHistory: () =>
    transaction<TrainingPlanHistoryEntry[]>('planHistory', 'readonly', (store) => store.getAll()),
  clearPlanHistory: () => transaction<undefined>('planHistory', 'readwrite', (store) => store.clear()),
  getAnalysisCache: (cacheKey: string) =>
    transaction<AnalysisCacheEntry | undefined>('analysisCache', 'readonly', (store) => store.get(cacheKey)),
  saveAnalysisCache: (entry: AnalysisCacheEntry) =>
    transaction<IDBValidKey>('analysisCache', 'readwrite', (store) => store.put(entry)),
  clearAnalysisCache: () => transaction<undefined>('analysisCache', 'readwrite', (store) => store.clear()),
  getWorkoutRevision: async () =>
    (await transaction<number | undefined>('settings', 'readonly', (store) => store.get('workoutRevision'))) || 0,
  bumpWorkoutRevision: async () => {
    const next = (await workoutDb.getWorkoutRevision()) + 1
    await transaction<IDBValidKey>('settings', 'readwrite', (store) => store.put(next, 'workoutRevision'))
    await workoutDb.clearAnalysisCache()
    return next
  },
}

function analysisConfig(config?: UserConfig) {
  return config ? { hrZones: config.hrZones, thresholds: config.thresholds } : undefined
}

import type { AnalysisResult } from '../analysis/analysisEngine'
export interface AnalysisCacheEntry {
  id: 'analysis'
  cacheKey: string
  createdAt: string
  dashboardSummary: AnalysisSummary
  analysisResult: AnalysisResult
}

export interface LocalBackup {
  version: 1
  exportedAt: string
  workouts: Workout[]
  config?: UserConfig
  appSettings?: AppSettings
  goals?: TrainingGoal[]
}

export async function exportBackup(): Promise<LocalBackup> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    workouts: await workoutDb.list(),
    config: await workoutDb.getConfig(),
    appSettings: await workoutDb.getAppSettings(),
    goals: await workoutDb.listGoals(),
  }
}

export async function importBackup(backup: LocalBackup): Promise<void> {
  if (backup.version !== 1 || !Array.isArray(backup.workouts)) throw new Error('Ungültiges LaufTrainer-Backup.')
  for (const workout of backup.workouts) await workoutDb.put(workout)
  if (backup.config) await workoutDb.saveConfig(backup.config)
  if (backup.appSettings) await workoutDb.saveAppSettings(backup.appSettings)
  for (const goal of backup.goals || []) await workoutDb.saveGoal(goal)
}
