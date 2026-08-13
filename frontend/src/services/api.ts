const DEFAULT_API_URL = 'https://lauftrainer-app-backend.christian-murschall.workers.dev/api'

export const API_URL = import.meta.env.VITE_AI_API_URL || DEFAULT_API_URL
export const API_ROOT = API_URL.replace(/\/api\/?$/, '')
