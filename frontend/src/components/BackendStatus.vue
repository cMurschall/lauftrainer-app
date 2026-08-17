<script lang="ts" setup>
import { useI18n } from '../i18n'

defineProps<{ status: 'checking' | 'online' | 'offline'; checkedAt: string; check: () => void }>()
const { t } = useI18n()
</script>
<template>
  <button :class="status" :title="t.checkBackend" class="backend-status" @click="check">
    <i></i><span v-if="status === 'checking'">{{ t.statusChecking }}</span
    ><span v-else-if="status === 'online'">{{ t.statusOnline }}</span
    ><span v-else>{{ t.statusOffline }}</span
    ><small v-if="checkedAt">{{ t.statusCheckedAt }} {{ checkedAt }}</small>
  </button>
</template>
