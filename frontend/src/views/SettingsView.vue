<script lang="ts" setup>
import { computed } from 'vue'
import { type Locale, useI18n } from '../i18n'
import UiSelect from '../components/UiSelect.vue'
import type { UserConfig } from '../types/workout'
import type { ConnectorId, ConnectorSettings, ThemePreference } from '../types/settings'

const props = defineProps<{
  config: UserConfig
  theme: ThemePreference
  connectors: ConnectorSettings[]
  saveConfig: () => void
  saveSettings: () => void
  downloadBackup: () => void
  restoreBackup: (event: Event) => void
  clearData: () => void
  connectConnector: (id: ConnectorId) => void
}>()
const emit = defineEmits<{ 'update:theme': [value: ThemePreference]; 'update:locale': [value: Locale] }>()
const { locale, t, setLocale } = useI18n()
const themeOptions = computed(() => [
  { label: t.value.themeSystem, value: 'system' },
  {
    label: t.value.themeLight,
    value: 'light',
  },
  { label: t.value.themeDark, value: 'dark' },
])
const languageOptions = computed(() => [
  { label: t.value.german, value: 'de' },
  { label: t.value.english, value: 'en' },
])

function changeLocale(value: Locale) {
  setLocale(value)
  emit('update:locale', value)
}
</script>
<template>
  <div class="page-heading">
    <h1>{{ t.settingsTitle }}</h1>
  </div>
  <section class="card settings-section">
    <p class="eyebrow">{{ t.appearance }}</p>
    <div class="form-grid">
      <label
        >{{ t.theme }}
        <UiSelect
          :ariaLabel="t.theme"
          :model-value="theme"
          :options="themeOptions"
          @update:model-value="
            (value) => {
              emit('update:theme', value as ThemePreference)
              saveSettings()
            }
          "
        /> </label
      ><label
        >{{ t.language }}
        <UiSelect
          :ariaLabel="t.language"
          :model-value="locale"
          :options="languageOptions"
          @update:model-value="
            (value) => {
              changeLocale(value as Locale)
              saveSettings()
            }
          "
        />
      </label>
    </div>
  </section>
  <section class="card settings-section">
    <p class="eyebrow">{{ t.athleteProfile }}</p>
    <div class="form-grid">
      <label>{{ t.name }}<input v-model="config.name" @change="saveConfig" /></label
      ><label>{{ t.lthr }}<input v-model.number="config.thresholds.lthr" type="number" @change="saveConfig" /></label>
    </div>
  </section>
  <section class="card settings-section">
    <p class="eyebrow">{{ t.connectors }}</p>
    <div class="connector-list">
      <article v-for="connector in props.connectors" :key="connector.id" class="connector-row">
        <div>
          <strong>{{ connector.name }}</strong
          ><span class="muted">{{ connector.connected ? t.connectorConnected : t.connectorNotConnected }}</span>
        </div>
        <div class="connector-controls">
          <button v-if="!connector.connected" class="button secondary" @click="connectConnector(connector.id)">
            {{ t.connectConnector }}
          </button>
          <label class="switch"
            ><input v-model="connector.active" type="checkbox" @change="saveSettings" /><span>{{
              connector.active ? t.connectorActive : t.connectorInactive
            }}</span></label
          >
        </div>
      </article>
    </div>
  </section>
  <section class="card settings-section">
    <p class="eyebrow">{{ t.dataSettings }}</p>
    <div class="settings-actions">
      <button class="button secondary" @click="downloadBackup">{{ t.exportBackup }}</button>
      <label class="button secondary"
        >{{ t.importBackup }}<input accept=".json" type="file" @change="restoreBackup"
      /></label>
      <button class="text-button" @click="clearData">{{ t.deleteData }}</button>
    </div>
    <p class="muted">{{ t.localUpload }}</p>
  </section>
</template>
