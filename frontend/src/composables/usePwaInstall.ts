import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'lauftrainer-pwa-install-dismissed'

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window) && /Safari/i.test(ua)
}

export function usePwaInstall() {
  const installed = ref(false)
  const canInstall = ref(false)
  const ios = ref(false)
  const dismissed = ref(localStorage.getItem(DISMISSED_KEY) === '1')
  let deferredPrompt: BeforeInstallPromptEvent | null = null

  const visible = computed(() => !installed.value && !dismissed.value && (canInstall.value || ios.value))

  function updateState() {
    installed.value = isStandalone()
    ios.value = !installed.value && isIosSafari()
  }

  function onBeforeInstallPrompt(event: Event) {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    canInstall.value = true
  }

  function onAppInstalled() {
    deferredPrompt = null
    canInstall.value = false
    installed.value = true
  }

  async function install() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    deferredPrompt = null
    canInstall.value = false
    if (choice.outcome === 'accepted') installed.value = true
  }

  function dismiss() {
    dismissed.value = true
    localStorage.setItem(DISMISSED_KEY, '1')
  }

  onMounted(() => {
    updateState()
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    document.addEventListener('visibilitychange', updateState)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.removeEventListener('appinstalled', onAppInstalled)
    document.removeEventListener('visibilitychange', updateState)
  })

  return { installed, canInstall, ios, visible, install, dismiss }
}
