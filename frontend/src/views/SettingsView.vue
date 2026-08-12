<script setup lang="ts">
import { computed } from 'vue'
import { useI18n, type Locale } from '../i18n'
import UiSelect from '../components/UiSelect.vue'
import type { UserConfig } from '../types/workout'
import type { ThemePreference } from '../types/settings'
defineProps<{ config: UserConfig; theme: ThemePreference; saveConfig: () => void; saveSettings: () => void; downloadBackup: () => void; restoreBackup: (event: Event) => void; clearData: () => void }>()
const emit = defineEmits<{ 'update:theme': [value: ThemePreference]; 'update:locale': [value: Locale] }>()
const { locale, t, setLocale } = useI18n()
const themeOptions = computed(() => [{ label: t.value.themeSystem, value: 'system' }, { label: t.value.themeLight, value: 'light' }, { label: t.value.themeDark, value: 'dark' }])
const languageOptions = computed(() => [{ label: t.value.german, value: 'de' }, { label: t.value.english, value: 'en' }])
function changeLocale(value: Locale) { setLocale(value); emit('update:locale', value) }
</script>
<template>
  <div class="page-heading"><div><p class="eyebrow">{{ t.settingsNav }}</p><h1>{{ t.settingsTitle }}</h1></div></div>
  <section class="card settings-section"><p class="eyebrow">{{ t.appearance }}</p><div class="form-grid"><label>{{ t.theme }}<UiSelect :model-value="theme" :options="themeOptions" :ariaLabel="t.theme" @update:model-value="value => { emit('update:theme', value as ThemePreference); saveSettings() }" /></label><label>{{ t.language }}<UiSelect :model-value="locale" :options="languageOptions" :ariaLabel="t.language" @update:model-value="value => { changeLocale(value as Locale); saveSettings() }" /></label></div></section>
  <section class="card settings-section"><p class="eyebrow">{{ t.athleteProfile }}</p><div class="form-grid"><label>{{ t.name }}<input v-model="config.name" @change="saveConfig"></label><label>{{ t.lthr }}<input v-model.number="config.thresholds.lthr" type="number" @change="saveConfig"></label></div></section>
  <section class="card settings-section"><p class="eyebrow">{{ t.dataSettings }}</p><div class="settings-actions"><button class="button secondary" @click="downloadBackup">{{ t.exportBackup }}</button><label class="button secondary">{{ t.importBackup }}<input type="file" accept=".json" @change="restoreBackup"></label><button class="text-button" @click="clearData">{{ t.deleteData }}</button></div><p class="muted">{{ t.localUpload }}</p></section>
</template>
