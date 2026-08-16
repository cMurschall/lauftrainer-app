import type { AnalysisResult } from '../analysis/analysisEngine'
import type { AnalysisSummary, TrainingPlan, TrainingPlanHistoryEntry, UserConfig, Workout } from '../types/workout'
import type { AppSettings, TrainingGoal } from '../types/settings'
import { mergeWorkouts, workoutIdentity } from '../services/workoutIdentity'
import { diagnosticLog } from '../services/logger'
import { toWorkoutSummary, type WorkoutSummary } from '../utils/workoutSummary'
import { planHasDatedDays } from '../utils/planDates'

const DB_NAME = 'lauftrainer-local'
const DB_VERSION = 7
const USER_DATA_STORES = ['workouts', 'settings', 'plans', 'planHistory', 'goals', 'analysisCache', 'mapContext'] as const

type StoredPlan = {
  id: 'current'
  plan?: TrainingPlan
  completedDates?: string[]
  /** @deprecated legacy weekday keys */
  completedDays?: string[]
  createdAt?: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
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
      if (!db.objectStoreNames.contains('mapContext')) db.createObjectStore('mapContext')
    }
    request.onsuccess = () => {
      const db = request.result
      db.onclose = () => {
        dbPromise = null
      }
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      diagnosticLog('db.open.success', { name: DB_NAME, version: db.version, stores: [...db.objectStoreNames] })
      resolve(db)
    }
    request.onerror = () => {
      dbPromise = null
      diagnosticLog('db.open.error', { name: DB_NAME, error: request.error?.message || String(request.error) })
      reject(request.error)
    }
  })
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest | void,
): Promise<T> {
  const db = await openDatabase()
  if (!db.objectStoreNames.contains(storeName)) {
    return Promise.reject(new DOMException(`Object store '${storeName}' is not a known object store name.`))
  }
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
      reject(error)
    }

    try {
      const request = action(dbTransaction.objectStore(storeName))
      if (request) {
        request.onsuccess = () => {
          result = request.result as T
          diagnosticLog('db.request.success', { transactionId, storeName, mode, resultType: typeof result })
        }
        request.onerror = () => fail(request.error)
      }
    } catch (error) {
      fail(error)
      return
    }

    dbTransaction.onerror = () => fail(dbTransaction.error)
    dbTransaction.onabort = () => fail(dbTransaction.error || new Error('IndexedDB transaction aborted'))
    dbTransaction.oncomplete = () => {
      if (settled) return
      settled = true
      diagnosticLog('db.transaction.complete', { transactionId, storeName, mode })
      resolve(result)
    }
  })
}

async function multiStoreTransaction(
  storeNames: readonly string[],
  mode: IDBTransactionMode,
  action: (stores: Record<string, IDBObjectStore>) => void | Promise<void>,
): Promise<void> {
  const db = await openDatabase()
  const existingStoreNames = storeNames.filter((name) => db.objectStoreNames.contains(name))
  if (existingStoreNames.length === 0) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const dbTransaction = db.transaction(existingStoreNames, mode)
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const stores = Object.fromEntries(existingStoreNames.map((name) => [name, dbTransaction.objectStore(name)]))
    Promise.resolve(action(stores)).catch(fail)
    dbTransaction.onerror = () => fail(dbTransaction.error)
    dbTransaction.onabort = () => fail(dbTransaction.error || new Error('IndexedDB transaction aborted'))
    dbTransaction.oncomplete = () => {
      if (settled) return
      settled = true
      resolve()
    }
  })
}

function normalizeWorkout(workout: Workout): Workout {
  return { ...workout, rawSport: workout.rawSport ?? workout.sport, records: workout.records || [] }
}

async function bumpRevisionInStore(settingsStore: IDBObjectStore): Promise<number> {
  const current = ((await requestToPromise(settingsStore.get('workoutRevision'))) as number | undefined) || 0
  const next = current + 1
  settingsStore.put(next, 'workoutRevision')
  return next
}

export const workoutDb = {
  list: async () =>
    (await transaction<Workout[]>('workouts', 'readonly', (store) => store.getAll())).map(normalizeWorkout),

  listSummaries: async (): Promise<WorkoutSummary[]> => (await workoutDb.list()).map(toWorkoutSummary),

  put: async (workout: Workout) => {
    const result = await transaction<IDBValidKey>('workouts', 'readwrite', (store) => store.put(normalizeWorkout(workout)))
    await workoutDb.bumpWorkoutRevision()
    return result
  },

  /** Batch upsert workouts with a single revision bump + cache clear. */
  putMany: async (workouts: Workout[]) => {
    if (!workouts.length) return
    await multiStoreTransaction(['workouts', 'settings', 'analysisCache'], 'readwrite', async (stores) => {
      for (const workout of workouts) stores.workouts.put(normalizeWorkout(workout))
      await bumpRevisionInStore(stores.settings)
      stores.analysisCache.clear()
    })
  },

  deleteAll: async () => {
    const result = await transaction<undefined>('workouts', 'readwrite', (store) => store.clear())
    await workoutDb.bumpWorkoutRevision()
    return result
  },

  deleteAllGoals: () => transaction<undefined>('goals', 'readwrite', (store) => store.clear()),

  delete: async (id: string) => {
    await transaction<undefined>('workouts', 'readwrite', (store) => store.delete(id))
    await workoutDb.bumpWorkoutRevision()
  },

  deleteMany: async (ids: string[]) => {
    if (!ids.length) return
    await multiStoreTransaction(['workouts', 'settings', 'analysisCache'], 'readwrite', async (stores) => {
      for (const id of ids) stores.workouts.delete(id)
      await bumpRevisionInStore(stores.settings)
      stores.analysisCache.clear()
    })
  },

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
    const staleIds = all.filter((workout) => !winnerIds.has(workout.id)).map((workout) => workout.id)
    await multiStoreTransaction(['workouts', 'settings', 'analysisCache'], 'readwrite', async (stores) => {
      for (const workout of grouped.values()) stores.workouts.put(normalizeWorkout(workout))
      for (const id of staleIds) stores.workouts.delete(id)
      await bumpRevisionInStore(stores.settings)
      stores.analysisCache.clear()
    })
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

  deleteConfig: () => transaction<undefined>('settings', 'readwrite', (store) => store.delete('config')),

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
          completedDates: previous.completedDates,
        })
      }
      return transaction<IDBValidKey>('plans', 'readwrite', (store) =>
        store.put({ id: 'current', createdAt: new Date().toISOString(), plan, completedDates: [] }),
      )
    })(),

  getPlan: async () => {
    const stored = await transaction<StoredPlan | undefined>('plans', 'readonly', (store) => store.get('current'))
    return normalizeStoredPlan(stored)
  },

  savePlanWithStatus: async (plan: TrainingPlan, completedDates: string[]) => {
    const previous = await workoutDb.getPlan()
    return transaction<IDBValidKey>('plans', 'readwrite', (store) =>
      store.put({
        id: 'current',
        createdAt: previous?.createdAt || new Date().toISOString(),
        plan,
        completedDates,
      }),
    )
  },

  clearCurrentPlan: () => transaction<undefined>('plans', 'readwrite', (store) => store.delete('current')),

  savePlanHistory: (entry: TrainingPlanHistoryEntry) =>
    transaction<IDBValidKey>('planHistory', 'readwrite', (store) => store.put(entry)),

  listPlanHistory: () => transaction<TrainingPlanHistoryEntry[]>('planHistory', 'readonly', (store) => store.getAll()),

  clearPlanHistory: () => transaction<undefined>('planHistory', 'readwrite', (store) => store.clear()),

  getAnalysisCache: (cacheKey: string) =>
    transaction<AnalysisCacheEntry | undefined>('analysisCache', 'readonly', (store) => store.get(cacheKey)),

  saveAnalysisCache: (entry: AnalysisCacheEntry) =>
    transaction<IDBValidKey>('analysisCache', 'readwrite', (store) => store.put(entry)),

  clearAnalysisCache: () => transaction<undefined>('analysisCache', 'readwrite', (store) => store.clear()),

  getMapContext: async (workoutId: string) => {
    const db = await openDatabase()
    if (!db.objectStoreNames.contains('mapContext')) return undefined
    try {
      return await transaction<{ waterways: number[][][]; highways: number[][][] } | undefined>('mapContext', 'readonly', (store) => store.get(workoutId))
    } catch {
      return undefined
    }
  },

  saveMapContext: async (workoutId: string, context: { waterways: number[][][]; highways: number[][][] }) => {
    const db = await openDatabase()
    if (!db.objectStoreNames.contains('mapContext')) return undefined
    try {
      return await transaction<IDBValidKey>('mapContext', 'readwrite', (store) => store.put(context, workoutId))
    } catch {
      return undefined
    }
  },

  getWorkoutRevision: async () =>
    (await transaction<number | undefined>('settings', 'readonly', (store) => store.get('workoutRevision'))) || 0,

  bumpWorkoutRevision: async () => {
    const next = (await workoutDb.getWorkoutRevision()) + 1
    await multiStoreTransaction(['settings', 'analysisCache'], 'readwrite', async (stores) => {
      stores.settings.put(next, 'workoutRevision')
      stores.analysisCache.clear()
    })
    return next
  },

  /**
   * Selectively wipe athlete data. App theme/locale/connectors/coach style stay.
   * Clearing workouts always invalidates the analysis cache and bumps the revision.
   */
  clearUserData: async (selection: ClearDataSelection) => {
    if (!hasClearDataSelection(selection)) return
    await multiStoreTransaction(USER_DATA_STORES, 'readwrite', async (stores) => {
      if (selection.workouts) {
        stores.workouts.clear()
        if (stores.mapContext) {
          stores.mapContext.clear()
          console.info('[LaufTrainer] Karten-Cache gelöscht (Workouts zurückgesetzt).')
          diagnosticLog('db.clear.mapContext', { trigger: 'workouts' })
        }
      }
      if (selection.mapContext && stores.mapContext) {
        stores.mapContext.clear()
        console.info('[LaufTrainer] Karten-Cache wurde erfolgreich geleert.')
        diagnosticLog('db.clear.mapContext', { trigger: 'manual' })
      }
      if (selection.goals) stores.goals.clear()
      if (selection.plan) {
        stores.plans.clear()
        stores.planHistory.clear()
      }
      if (selection.profile) stores.settings.delete('config')
      if (selection.workouts || selection.profile) {
        stores.analysisCache.clear()
        await bumpRevisionInStore(stores.settings)
      }
    })
  },

  /** Atomically wipe all athlete data (keeps app theme/locale settings). */
  clearAllUserData: async () => {
    await workoutDb.clearUserData(defaultClearDataSelection())
  },
}

export type ClearDataKey = 'workouts' | 'plan' | 'goals' | 'profile' | 'mapContext'

export type ClearDataSelection = Partial<Record<ClearDataKey, boolean>>

export function defaultClearDataSelection(): ClearDataSelection {
  return { workouts: true, plan: true, goals: true, profile: true, mapContext: true }
}

export function hasClearDataSelection(selection: ClearDataSelection): boolean {
  return Object.values(selection).some(Boolean)
}

function analysisConfig(config?: UserConfig) {
  return config ? { hrZones: config.hrZones, thresholds: config.thresholds } : undefined
}

function normalizeStoredPlan(stored: StoredPlan | undefined): StoredPlan | undefined {
  if (!stored?.plan) return stored
  const days = stored.plan.days || []
  const hasDates = planHasDatedDays(days)
  const completedDates = hasDates
    ? (stored.completedDates || []).filter((date) => days.some((day) => day.date === date))
    : []
  const startDate = stored.plan.start_date || (hasDates ? days[0]?.date : undefined)
  return {
    ...stored,
    plan: startDate ? { ...stored.plan, start_date: startDate } : stored.plan,
    completedDates,
    completedDays: undefined,
  }
}

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
  currentPlan?: StoredPlan
  planHistory?: TrainingPlanHistoryEntry[]
}

export async function exportBackup(): Promise<LocalBackup> {
  const [workouts, config, appSettings, goals, currentPlan, planHistory] = await Promise.all([
    workoutDb.list(),
    workoutDb.getConfig(),
    workoutDb.getAppSettings(),
    workoutDb.listGoals(),
    workoutDb.getPlan(),
    workoutDb.listPlanHistory(),
  ])
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    workouts,
    config,
    appSettings,
    goals,
    currentPlan: currentPlan?.plan ? currentPlan : undefined,
    planHistory,
  }
}

export async function importBackup(backup: LocalBackup): Promise<void> {
  if (backup.version !== 1 || !Array.isArray(backup.workouts)) throw new Error('Ungültiges LaufTrainer-Backup.')

  await multiStoreTransaction(USER_DATA_STORES, 'readwrite', async (stores) => {
    stores.workouts.clear()
    stores.goals.clear()
    stores.plans.clear()
    stores.planHistory.clear()
    stores.analysisCache.clear()
    if (stores.mapContext) {
      stores.mapContext.clear()
      console.info('[LaufTrainer] Karten-Cache vor Backup-Import geleert.')
      diagnosticLog('db.clear.mapContext', { trigger: 'backup_import' })
    }
    stores.settings.delete('config')

    for (const workout of backup.workouts) stores.workouts.put(normalizeWorkout(workout))
    for (const goal of backup.goals || []) stores.goals.put(goal)
    if (backup.config) stores.settings.put(backup.config, 'config')
    if (backup.appSettings) stores.settings.put(backup.appSettings, 'app')
    if (backup.currentPlan?.plan) {
      const normalized = normalizeStoredPlan({
        id: 'current',
        createdAt: backup.currentPlan.createdAt || new Date().toISOString(),
        plan: backup.currentPlan.plan,
        completedDates: backup.currentPlan.completedDates,
        completedDays: backup.currentPlan.completedDays,
      })
      if (normalized) stores.plans.put(normalized)
    }
    for (const entry of backup.planHistory || []) stores.planHistory.put(entry)

    const revision = ((await requestToPromise(stores.settings.get('workoutRevision'))) as number | undefined) || 0
    stores.settings.put(revision + 1, 'workoutRevision')
  })
}
