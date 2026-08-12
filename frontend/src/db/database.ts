import type { UserConfig, Workout, TrainingPlanDay } from '../types/workout'

const DB_NAME = 'lauftrainer-local'
const DB_VERSION = 2

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('workouts')) db.createObjectStore('workouts', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
      if (!db.objectStoreNames.contains('plans')) db.createObjectStore('plans', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(storeName, mode).objectStore(storeName))
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}

export const workoutDb = {
  list: () => transaction<Workout[]>('workouts', 'readonly', store => store.getAll()),
  put: (workout: Workout) => transaction<IDBValidKey>('workouts', 'readwrite', store => store.put(workout)),
  deleteAll: () => transaction<undefined>('workouts', 'readwrite', store => store.clear()),
  getConfig: () => transaction<UserConfig | undefined>('settings', 'readonly', store => store.get('config')),
  saveConfig: (config: UserConfig) => transaction<IDBValidKey>('settings', 'readwrite', store => store.put(config, 'config')),
  savePlan: (plan: TrainingPlanDay[]) => transaction<IDBValidKey>('plans', 'readwrite', store => store.put({ id: 'current', createdAt: new Date().toISOString(), plan }))
}

export interface LocalBackup {
  version: 1
  exportedAt: string
  workouts: Workout[]
  config?: UserConfig
}

export async function exportBackup(): Promise<LocalBackup> {
  return { version: 1, exportedAt: new Date().toISOString(), workouts: await workoutDb.list(), config: await workoutDb.getConfig() }
}

export async function importBackup(backup: LocalBackup): Promise<void> {
  if (backup.version !== 1 || !Array.isArray(backup.workouts)) throw new Error('Ungültiges LaufTrainer-Backup.')
  for (const workout of backup.workouts) await workoutDb.put(workout)
  if (backup.config) await workoutDb.saveConfig(backup.config)
}
