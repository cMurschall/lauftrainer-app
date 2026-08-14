import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type NotificationType = 'success' | 'error' | 'info'

export const useUiStore = defineStore('ui', () => {
  const notification = ref<{ message: string; type: NotificationType }>({ message: '', type: 'info' })
  const loading = ref(false)
  const consent = ref(false)
  const connectorLoading = ref(false)
  const credits = ref(0)
  const backendStatus = ref<'checking' | 'online' | 'offline'>('checking')
  const backendVersion = ref('–')
  const backendCommit = ref('')
  const backendCheckedAt = ref('')
  const importProgress = ref({ active: false, current: 0, total: 0, fileName: '', failed: 0 })

  let notificationTimer: number | undefined

  function notify(message: string, type: NotificationType = 'info') {
    window.clearTimeout(notificationTimer)
    notification.value = { message, type }
    notificationTimer = window.setTimeout(() => {
      notification.value = { message: '', type: 'info' }
    }, 4500)
  }

  function dismissNotification() {
    window.clearTimeout(notificationTimer)
    notification.value = { message: '', type: 'info' }
  }

  const hasNotification = computed(() => Boolean(notification.value.message))

  return {
    notification,
    hasNotification,
    loading,
    consent,
    connectorLoading,
    credits,
    backendStatus,
    backendVersion,
    backendCommit,
    backendCheckedAt,
    importProgress,
    notify,
    dismissNotification,
  }
})
