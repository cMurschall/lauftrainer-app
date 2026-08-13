<script lang="ts" setup>
import { useI18n } from '../i18n'

defineProps<{ status: 'checking' | 'online' | 'offline'; version: string; checkedAt: string; check: () => void }>()
const { t } = useI18n()
</script>
<template>
  <button :class="status" :title="t.checkBackend" class="backend-status" @click="check">
    <i></i><span v-if="status === 'checking'">{{ t.checking }}</span
    ><span v-else-if="status === 'online'">{{ t.online }} · v{{ version }}</span
    ><span v-else>{{ t.offline }}</span
    ><small v-if="checkedAt">{{ checkedAt }}</small>
  </button>
</template>
