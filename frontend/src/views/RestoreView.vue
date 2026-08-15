<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from '../i18n'
import { applyWalletToken } from '../services/billingService'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const ui = useUiStore()
const status = ref<'working' | 'success' | 'missing' | 'error'>('working')
const message = ref('')
const balance = ref(0)

function readTokenFromHash() {
  const raw = window.location.hash.replace(/^#/, '')
  const params = new URLSearchParams(raw.includes('=') ? raw : `token=${raw}`)
  return (params.get('token') || '').trim()
}

onMounted(async () => {
  const token = readTokenFromHash()
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  if (!token) {
    status.value = 'missing'
    message.value = t.value.restoreMissing
    return
  }
  try {
    balance.value = await applyWalletToken(token)
    ui.credits = balance.value
    status.value = 'success'
    message.value = t.value.restoreSuccess.replace('{balance}', String(balance.value))
  } catch (cause) {
    status.value = 'error'
    message.value = cause instanceof Error ? cause.message : t.value.restoreFailed
  }
})
</script>

<template>
  <main class="restore-page">
    <h1>{{ t.restoreTitle }}</h1>
    <p v-if="status === 'working'" class="muted">{{ t.restoreWorking }}</p>
    <p v-else-if="status === 'success'" class="form-success">{{ message }}</p>
    <p v-else class="form-error">{{ message }}</p>
    <RouterLink v-if="status !== 'working'" class="button primary" to="/">{{ t.restoreToDashboard }}</RouterLink>
  </main>
</template>
