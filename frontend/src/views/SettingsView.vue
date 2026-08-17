<script lang="ts" setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { type Locale, useI18n } from '../i18n'
import UiSelect from '../components/UiSelect.vue'
import PageHeader from '../components/PageHeader.vue'
import { TRAINING_SPORT_CATEGORIES } from '../types/workout'
import type {
  CoachStyle,
  ConnectorId,
  MapDetailsConsent,
  ThemePreference,
  TrainingGoal,
  GoalType,
} from '../types/settings'
import { useSettingsStore } from '../stores/settings'
import { useWorkoutStore } from '../stores/workouts'
import { usePlanStore } from '../stores/plan'
import { useUiStore } from '../stores/ui'
import { useAnalysisStore } from '../stores/analysis'
import { clearLocalData, downloadBackup, restoreBackup } from '../stores/dataLifecycle'
import { defaultClearDataSelection, hasClearDataSelection, type ClearDataSelection } from '../db/database'
import { shouldWarnPolarStravaOverlap } from '../utils/dashboardUi'
import {
  canonicalizeTrainingSport,
  isKnownTrainingSport,
  normalizeAvailableSportsList,
  sportsFromWorkouts,
} from '../utils/trainingSports'

const route = useRoute()
const settings = useSettingsStore()
const workouts = useWorkoutStore()
const planStore = usePlanStore()
const ui = useUiStore()
const analysis = useAnalysisStore()

const { theme, connectors, goals, config, coachStyle, mapDetailsConsent } = storeToRefs(settings)
const { summaries } = storeToRefs(workouts)
const { plan } = storeToRefs(planStore)
const { importProgress } = storeToRefs(ui)

const { locale, t } = useI18n()
const showGoalForm = ref(false)
const workoutFileInput = ref<HTMLInputElement | null>(null)
const backupFileInput = ref<HTMLInputElement | null>(null)
const editingGoalId = ref<string | null>(null)
const goalType = ref<GoalType>('personal')
const goalForm = ref({
  title: '',
  date: '',
  sport: 'Running',
  distanceKm: undefined as number | undefined,
  targetTime: '',
  targetPace: '',
  priority: 'B' as 'A' | 'B' | 'C',
  notes: '',
})
const goalError = ref('')
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const weekdayLabels = computed(() => ({
  monday: t.value.monday,
  tuesday: t.value.tuesday,
  wednesday: t.value.wednesday,
  thursday: t.value.thursday,
  friday: t.value.friday,
  saturday: t.value.saturday,
  sunday: t.value.sunday,
}))
const sortedGoals = computed(() => [...goals.value].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')))
const workoutDateRange = computed(() => {
  const dates = summaries.value.map((workout) => workout.date.slice(0, 10)).sort()
  if (!dates.length) return t.value.noLocalWorkouts
  const format = (date: string) =>
    new Intl.DateTimeFormat(locale.value, { month: '2-digit', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
  return `${format(dates[0])} – ${format(dates[dates.length - 1])}`
})
const localDataSize = computed(() => {
  const data = JSON.stringify({ workouts: summaries.value, goals: goals.value, plan: plan.value })
  const bytes = new TextEncoder().encode(data).length
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
})
const themeOptions = computed(() => [
  { label: t.value.themeSystem, value: 'system' },
  { label: t.value.themeLight, value: 'light' },
  { label: t.value.themeDark, value: 'dark' },
])
const languageOptions = computed(() => [
  { label: t.value.german, value: 'de' },
  { label: t.value.english, value: 'en' },
])
const mapDetailsConsentOptions = computed(() => [
  { label: t.value.mapDetailsConsentAsk, value: 'unset' },
  { label: t.value.mapDetailsConsentAllowed, value: 'allowed' },
  { label: t.value.mapDetailsConsentDenied, value: 'denied' },
])
const trainingGoalOptions = computed(() => [
  { label: t.value.goalBaseEndurance, value: 'base_endurance' },
  { label: t.value.goalPerformance, value: 'performance' },
  { label: t.value.goalRecovery, value: 'recovery' },
  { label: t.value.goalGeneralFitness, value: 'general_fitness' },
])
const coachStyleOptions = computed(() => [
  { value: 'mentor' as const, label: t.value.coachMentor, description: t.value.coachMentorHelp },
  { value: 'pragmatist' as const, label: t.value.coachPragmatist, description: t.value.coachPragmatistHelp },
  { value: 'performance' as const, label: t.value.coachPerformance, description: t.value.coachPerformanceHelp },
])
const enduranceSports = ['Cycling', 'Running', 'Hiking', 'Swimming', 'Cardio'] as const
const supportSports = ['Strength', 'Mobility'] as const
const customSportInput = ref('')
const sportLabel = (sport: string) => {
  if (isKnownTrainingSport(sport)) {
    const key = canonicalizeTrainingSport(sport).toLowerCase() as
      'running' | 'cycling' | 'swimming' | 'hiking' | 'cardio' | 'strength' | 'mobility'
    return t.value[key]
  }
  return sport
}
const workoutSports = computed(() => sportsFromWorkouts(summaries.value))
const knownSportOptions = computed(() =>
  TRAINING_SPORT_CATEGORIES.map((sport) => ({ value: sport, label: sportLabel(sport), source: 'known' as const })),
)
const extraSportOptions = computed(() => {
  const known = new Set(TRAINING_SPORT_CATEGORIES.map((sport) => sport.toLowerCase()))
  const selected = config.value.availableSports || []
  return normalizeAvailableSportsList([...workoutSports.value, ...selected])
    .filter((sport) => !known.has(sport.toLowerCase()))
    .map((sport) => ({
      value: sport,
      label: sportLabel(sport),
      source: workoutSports.value.some((item) => item.toLowerCase() === sport.toLowerCase())
        ? ('workout' as const)
        : ('custom' as const),
    }))
})
const showPolarStravaOverlapWarning = computed(() => shouldWarnPolarStravaOverlap(connectors.value))
const showDeletePanel = ref(false)
const deleteSelection = ref<ClearDataSelection>(defaultClearDataSelection())
const canDeleteSelection = computed(() => hasClearDataSelection(deleteSelection.value))

async function openDeletePanel() {
  deleteSelection.value = defaultClearDataSelection()
  showDeletePanel.value = true
}

function closeDeletePanel() {
  showDeletePanel.value = false
}

async function confirmDeleteSelection() {
  const deleted = await clearLocalData({ ...deleteSelection.value })
  if (deleted) showDeletePanel.value = false
}

function openWorkoutFilePicker() {
  workoutFileInput.value?.click()
}

function openBackupFilePicker() {
  backupFileInput.value?.click()
}

async function scrollToConnectors() {
  if (route.hash !== '#connectors') return
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  document.getElementById('connectors')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(() => {
  void scrollToConnectors()
})

watch(
  () => route.hash,
  () => {
    void scrollToConnectors()
  },
)

async function changeTheme(value: ThemePreference) {
  settings.updateTheme(value)
  await settings.saveSettings()
}

async function changeLocale(value: Locale) {
  settings.updateLocale(value)
  await settings.saveSettings()
}

async function changeCoachStyle(value: CoachStyle) {
  await settings.updateCoachStyle(value)
}

async function changeMapDetailsConsent(value: MapDetailsConsent) {
  await settings.updateMapDetailsConsent(value)
}

async function saveConfigAndRefresh() {
  await settings.saveConfig()
  await analysis.refreshAnalysis()
}

function togglePreferredDay(day: string) {
  const enabled = config.value.preferredTrainingDays.includes(day)
  const next = enabled
    ? config.value.preferredTrainingDays.filter((item) => item !== day)
    : [...config.value.preferredTrainingDays, day]
  if (!next.length) {
    ui.notify(t.value.preferredDaysRequired, 'info')
    return
  }
  config.value.preferredTrainingDays = next
  void saveConfigAndRefresh()
}

function changeTrainingGoal(value: string) {
  config.value.trainingGoal = value
  void saveConfigAndRefresh()
}

function isSportSelected(sport: string) {
  return (config.value.availableSports || []).some((item) => item.toLowerCase() === sport.toLowerCase())
}

function toggleAvailableSport(sport: string) {
  const available = config.value.availableSports || []
  const selected = isSportSelected(sport)
  const next = selected
    ? available.filter((item) => item.toLowerCase() !== sport.toLowerCase())
    : normalizeAvailableSportsList([...available, sport])
  if (!next.length) {
    ui.notify(t.value.availableSportsRequired, 'info')
    return
  }
  config.value.availableSports = next
  void saveConfigAndRefresh()
}

function addCustomSport() {
  const sport = canonicalizeTrainingSport(customSportInput.value)
  if (!sport) return
  const next = normalizeAvailableSportsList([...(config.value.availableSports || []), sport])
  config.value.availableSports = next
  customSportInput.value = ''
  void saveConfigAndRefresh()
}

function resetGoalForm() {
  goalForm.value = {
    title: '',
    date: '',
    sport: 'Running',
    distanceKm: undefined,
    targetTime: '',
    targetPace: '',
    priority: 'B',
    notes: '',
  }
  goalType.value = 'personal'
  goalError.value = ''
  editingGoalId.value = null
}

function editGoal(goal: TrainingGoal) {
  editingGoalId.value = goal.id
  goalType.value = goal.type
  goalForm.value = {
    title: goal.title,
    date: goal.date || '',
    sport: goal.sport || 'Running',
    distanceKm: goal.distanceKm,
    targetTime: goal.targetTime || '',
    targetPace: goal.targetPace || '',
    priority: goal.priority || 'B',
    notes: goal.notes || '',
  }
  goalError.value = ''
  showGoalForm.value = true
}

function submitGoal() {
  if (!goalForm.value.title.trim() || (goalType.value === 'race' && !goalForm.value.date)) {
    goalError.value = t.value.goalRequired
    return
  }
  void settings.saveGoal({
    id: editingGoalId.value || crypto.randomUUID(),
    type: goalType.value,
    title: goalForm.value.title.trim(),
    date: goalForm.value.date || undefined,
    sport: goalForm.value.sport || undefined,
    distanceKm: goalForm.value.distanceKm,
    targetTime: goalForm.value.targetTime.trim() || undefined,
    targetPace: goalForm.value.targetPace.trim() || undefined,
    priority: goalType.value === 'race' ? goalForm.value.priority : undefined,
    notes: goalForm.value.notes.trim() || undefined,
    createdAt: new Date().toISOString(),
  })
  resetGoalForm()
  showGoalForm.value = false
}

async function onImportFiles(event: Event) {
  await workouts.importFiles(event)
  await analysis.refreshAnalysis()
}

async function setConnectorActive(id: ConnectorId, active: boolean) {
  settings.setConnectorActive(id, active)
  await settings.saveSettings()
}
</script>
<template>
  <PageHeader :label="t.settingsNav" :meta="t.settingsIntro" />
  <section class="card settings-section">
    <p class="eyebrow">{{ t.appearance }}</p>
    <div class="form-grid">
      <label
        >{{ t.theme }}
        <UiSelect
          :ariaLabel="t.theme"
          :model-value="theme"
          :options="themeOptions"
          @update:model-value="(value) => changeTheme(value as ThemePreference)"
        /> </label
      ><label
        >{{ t.language }}
        <UiSelect
          :ariaLabel="t.language"
          :model-value="locale"
          :options="languageOptions"
          @update:model-value="(value) => changeLocale(value as Locale)"
        />
      </label>
    </div>
  </section>
  <section class="card settings-section">
    <p class="eyebrow">{{ t.mapDetailsSettingsTitle }}</p>
    <p class="field-help settings-help">{{ t.mapDetailsSettingsHelp }}</p>
    <div class="form-grid">
      <label
        >{{ t.mapDetailsSettingsTitle }}
        <UiSelect
          :ariaLabel="t.mapDetailsSettingsTitle"
          :model-value="mapDetailsConsent"
          :options="mapDetailsConsentOptions"
          @update:model-value="(value) => changeMapDetailsConsent(value as MapDetailsConsent)"
        />
      </label>
    </div>
    <p class="muted">
      <RouterLink to="/datenschutz">{{ t.mapDetailsConsentPrivacyLink }}</RouterLink>
    </p>
  </section>
  <section class="card settings-section">
    <p class="eyebrow">{{ t.athleteProfile }}</p>
    <div class="form-grid">
      <label
        >{{ t.lthr }}<input v-model.number="config.thresholds.lthr" type="number" @change="saveConfigAndRefresh" /><span
          class="field-help"
          >{{ t.lthrHelp }}</span
        ></label
      >
      <label
        >{{ t.trainingGoal
        }}<UiSelect
          :model-value="config.trainingGoal || config.trainingFocus || 'base_endurance'"
          :ariaLabel="t.trainingGoal"
          :options="trainingGoalOptions"
          @update:model-value="changeTrainingGoal"
        />
      </label>
      <label
        >{{ t.performanceNotes
        }}<textarea v-model="config.performanceNotes" rows="3" @change="saveConfigAndRefresh"></textarea>
      </label>
      <label
        >{{ t.limitations }}<textarea v-model="config.limitations" rows="3" @change="saveConfigAndRefresh"></textarea>
      </label>
    </div>
  </section>
  <section class="card settings-section">
    <p class="eyebrow">{{ t.trainingFramework }}</p>
    <label class="checkbox-field framework-strength">
      <input v-model="config.strengthTraining" type="checkbox" @change="saveConfigAndRefresh" />
      {{ t.strengthTraining }}
    </label>

    <div class="sport-framework">
      <div class="sport-framework-head">
        <p class="field-heading">{{ t.availableSports }}</p>
        <p class="field-help settings-help">{{ t.availableSportsHelp }}</p>
      </div>

      <div class="sport-group">
        <p class="sport-group-label">{{ t.enduranceSports }}</p>
        <div class="weekday-picks">
          <label
            v-for="option in knownSportOptions.filter((item) =>
              enduranceSports.includes(item.value as (typeof enduranceSports)[number]),
            )"
            :key="option.value"
            class="checkbox-field"
          >
            <input
              :checked="isSportSelected(option.value)"
              type="checkbox"
              @change="toggleAvailableSport(option.value)"
            />{{ option.label }}
          </label>
        </div>
      </div>

      <div class="sport-group">
        <p class="sport-group-label">{{ t.supportSports }}</p>
        <div class="weekday-picks">
          <label
            v-for="option in knownSportOptions.filter((item) =>
              supportSports.includes(item.value as (typeof supportSports)[number]),
            )"
            :key="option.value"
            class="checkbox-field"
          >
            <input
              :checked="isSportSelected(option.value)"
              type="checkbox"
              @change="toggleAvailableSport(option.value)"
            />{{ option.label }}
          </label>
        </div>
      </div>

      <div v-if="extraSportOptions.length" class="sport-group">
        <p class="sport-group-label">{{ t.extraSports }}</p>
        <div class="weekday-picks">
          <label v-for="option in extraSportOptions" :key="option.value" class="checkbox-field">
            <input
              :checked="isSportSelected(option.value)"
              type="checkbox"
              @change="toggleAvailableSport(option.value)"
            />{{ option.label }}<span v-if="option.source === 'workout'" class="muted"> · {{ t.fromWorkouts }}</span>
          </label>
        </div>
      </div>

      <div class="sport-add">
        <p class="sport-group-label">{{ t.addCustomSport }}</p>
        <div class="sport-add-control">
          <input
            v-model="customSportInput"
            maxlength="40"
            type="text"
            autocomplete="off"
            :placeholder="t.addCustomSportPlaceholder"
            :aria-label="t.addCustomSport"
            @keydown.enter.prevent="addCustomSport"
          />
          <button class="button secondary" type="button" @click="addCustomSport">{{ t.addSport }}</button>
        </div>
      </div>
    </div>

    <div class="sport-framework days-framework">
      <div class="sport-framework-head">
        <p class="field-heading">{{ t.preferredDays }}</p>
        <p class="field-help settings-help">{{ t.preferredDaysHelp }}</p>
      </div>
      <div class="weekday-picks">
        <label v-for="day in weekdays" :key="day" class="checkbox-field">
          <input
            :checked="config.preferredTrainingDays.includes(day)"
            type="checkbox"
            @change="togglePreferredDay(day)"
          />{{ weekdayLabels[day] }}
        </label>
      </div>
    </div>
  </section>
  <section class="card settings-section">
    <p class="eyebrow">{{ t.coachStyle }}</p>
    <p class="field-help settings-help">{{ t.coachStyleHelp }}</p>
    <div class="coach-style-picks">
      <label
        v-for="option in coachStyleOptions"
        :key="option.value"
        class="coach-style-option"
        :class="{ active: coachStyle === option.value }"
      >
        <input
          :checked="coachStyle === option.value"
          name="coach-style"
          type="radio"
          :value="option.value"
          @change="changeCoachStyle(option.value)"
        />
        <strong>{{ option.label }}</strong>
        <span class="muted">{{ option.description }}</span>
      </label>
    </div>
  </section>
  <section class="card settings-section">
    <div class="card-heading">
      <div>
        <p class="eyebrow">{{ t.goals }}</p>
        <p class="muted">{{ t.goalsIntro }}</p>
      </div>
      <button class="button secondary" type="button" @click="showGoalForm = !showGoalForm">{{ t.addGoal }}</button>
    </div>
    <form v-if="showGoalForm" class="goal-form" @submit.prevent="submitGoal">
      <div class="goal-type-switch">
        <button
          class="button"
          :class="goalType === 'personal' ? 'primary' : 'secondary'"
          type="button"
          @click="goalType = 'personal'"
        >
          {{ t.personalGoal }}
        </button>
        <button
          class="button"
          :class="goalType === 'race' ? 'primary' : 'secondary'"
          type="button"
          @click="goalType = 'race'"
        >
          {{ t.race }}
        </button>
      </div>
      <div class="form-grid">
        <label>{{ t.goalTitle }} *<input v-model="goalForm.title" required /></label>
        <label>{{ t.goalDate }}<input v-model="goalForm.date" :required="goalType === 'race'" type="date" /></label>
        <label>{{ t.goalSport }}<input v-model="goalForm.sport" /></label>
        <label
          >{{ t.goalDistance }}<input v-model.number="goalForm.distanceKm" min="0" step="0.1" type="number"
        /></label>
        <label>{{ t.targetTime }}<input v-model="goalForm.targetTime" placeholder="z. B. 1:45:00" /></label>
        <label>{{ t.targetPace }}<input v-model="goalForm.targetPace" placeholder="z. B. 5:00 min/km" /></label>
        <label v-if="goalType === 'race'"
          >{{ t.priority
          }}<UiSelect
            v-model="goalForm.priority"
            :ariaLabel="t.priority"
            :options="[
              { label: 'A', value: 'A' },
              { label: 'B', value: 'B' },
              { label: 'C', value: 'C' },
            ]"
        /></label>
        <label>{{ t.goalNotes }}<input v-model="goalForm.notes" /></label>
      </div>
      <p v-if="goalError" class="form-error">{{ goalError }}</p>
      <div class="settings-actions">
        <button class="button primary" type="submit">{{ editingGoalId ? t.updateGoal : t.saveGoal }}</button>
        <button class="button secondary" type="button" @click="showGoalForm = false">{{ t.cancel }}</button>
      </div>
    </form>
    <div v-if="sortedGoals.length" class="goal-list">
      <article v-for="goal in sortedGoals" :key="goal.id" class="goal-row">
        <button class="text-button" type="button" :aria-label="t.editGoal" @click="editGoal(goal)">
          {{ t.editGoal }}
        </button>
        <span v-if="goal.targetTime || goal.targetPace || goal.priority" class="goal-target">
          <template v-if="goal.priority">{{ goal.priority }}</template
          ><template v-if="goal.targetTime"> · {{ goal.targetTime }}</template
          ><template v-if="goal.targetPace"> · {{ goal.targetPace }}</template>
        </span>
        <div class="goal-date">
          {{
            goal.date
              ? new Date(`${goal.date}T12:00:00`).toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : '—'
          }}
        </div>
        <div class="goal-copy">
          <strong>{{ goal.title }}</strong
          ><span
            >{{ goal.type === 'race' ? t.race : t.personalGoal
            }}<template v-if="goal.sport"> · {{ goal.sport }}</template
            ><template v-if="goal.distanceKm"> · {{ goal.distanceKm }} km</template
            ><template v-if="goal.target"> · {{ goal.target }}</template></span
          >
        </div>
        <button
          class="icon-button danger"
          type="button"
          :aria-label="t.deleteGoal"
          :title="t.deleteGoal"
          @click="settings.deleteGoal(goal.id)"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </svg>
        </button>
      </article>
    </div>
    <p v-else class="muted">{{ t.noGoals }}</p>
  </section>
  <section id="connectors" class="card settings-section">
    <p class="eyebrow">{{ t.connectors }}</p>
    <p
      v-if="showPolarStravaOverlapWarning"
      class="notice notice-warning"
      role="status"
      data-banner="polarStravaOverlap"
    >
      {{ t.polarStravaOverlapWarning }}
    </p>
    <div class="connector-list">
      <article v-for="connector in connectors" :key="connector.id" class="connector-row">
        <div>
          <strong>{{ connector.name }}</strong
          ><span class="muted">{{ connector.connected ? t.connectorConnected : t.connectorNotConnected }}</span>
        </div>
        <div class="connector-controls">
          <button
            v-if="!connector.connected"
            class="button primary connector-action"
            type="button"
            @click="settings.connectConnector(connector.id)"
          >
            {{ t.connectConnector }}
          </button>
          <button
            v-else
            class="button secondary connector-action"
            type="button"
            @click="settings.removeConnector(connector.id)"
          >
            {{ t.disconnectConnector }}
          </button>
          <label class="switch"
            ><input
              :checked="connector.active"
              type="checkbox"
              @change="setConnectorActive(connector.id, ($event.target as HTMLInputElement).checked)"
            /><span>{{ connector.active ? t.connectorActive : t.connectorInactive }}</span></label
          >
        </div>
      </article>
    </div>
  </section>
  <section class="card settings-section">
    <p class="eyebrow">{{ t.dataSettings }}</p>
    <div class="local-data-summary">
      <div>
        <strong>{{ summaries.length }}</strong>
        <span>{{ t.localWorkouts }}</span>
      </div>
      <div>
        <strong>{{ workoutDateRange }}</strong>
        <span>{{ t.localPeriod }}</span>
      </div>
      <div>
        <strong>{{ goals.length }} · {{ plan.days.length }}</strong>
        <span>{{ t.localGoalsAndPlan }}</span>
      </div>
      <div>
        <strong>~{{ localDataSize }}</strong>
        <span>{{ t.localStorageUsed }}</span>
      </div>
    </div>
    <div class="settings-actions">
      <input
        ref="workoutFileInput"
        :disabled="importProgress.active"
        accept=".csv,.json,.tcx,.gpx,.fit"
        multiple
        type="file"
        @change="onImportFiles"
      />
      <button class="button secondary data-action" type="button" @click="downloadBackup">{{ t.exportBackup }}</button>
      <input ref="backupFileInput" accept=".json" type="file" @change="restoreBackup" />
      <button class="button secondary data-action" type="button" @click="openBackupFilePicker">
        {{ t.importBackup }}
      </button>
      <button class="button secondary data-action" type="button" @click="openWorkoutFilePicker">
        {{ t.importFiles }}
      </button>
      <button v-if="!showDeletePanel" class="button data-action danger-action" type="button" @click="openDeletePanel">
        {{ t.deleteData }}
      </button>
    </div>
    <div v-if="showDeletePanel" class="delete-panel" role="group" :aria-label="t.deleteData">
      <p class="muted delete-panel-help">{{ t.deleteDataHelp }}</p>
      <div class="delete-options">
        <label class="delete-option">
          <input v-model="deleteSelection.workouts" type="checkbox" />
          <span>
            <strong>{{ t.deleteWorkouts }}</strong>
            <small>{{ summaries.length }}</small>
          </span>
        </label>
        <label class="delete-option">
          <input v-model="deleteSelection.plan" type="checkbox" />
          <span>
            <strong>{{ t.deletePlan }}</strong>
            <small>{{ plan.days.length }}</small>
          </span>
        </label>
        <label class="delete-option">
          <input v-model="deleteSelection.goals" type="checkbox" />
          <span>
            <strong>{{ t.deleteGoals }}</strong>
            <small>{{ goals.length }}</small>
          </span>
        </label>
        <label class="delete-option">
          <input v-model="deleteSelection.profile" type="checkbox" />
          <span>
            <strong>{{ t.deleteProfile }}</strong>
            <small>{{ t.deleteProfileHelp }}</small>
          </span>
        </label>
      </div>
      <div class="settings-actions delete-panel-actions">
        <button
          class="button data-action danger-action"
          type="button"
          :disabled="!canDeleteSelection"
          @click="confirmDeleteSelection"
        >
          {{ t.deleteConfirmAction }}
        </button>
        <button class="button secondary data-action" type="button" @click="closeDeletePanel">
          {{ t.deleteCancelAction }}
        </button>
      </div>
    </div>
    <div v-if="importProgress.active" class="import-progress" aria-live="polite" aria-busy="true">
      <div class="card-heading">
        <p class="eyebrow">{{ t.importProgressLabel }}</p>
        <strong>{{ importProgress.current }} / {{ importProgress.total }}</strong>
      </div>
      <progress :max="importProgress.total" :value="importProgress.current"></progress>
      <small>{{ importProgress.fileName }}</small>
    </div>
    <p class="muted local-storage-explainer">{{ t.localStorageExplainer }}</p>
    <p class="muted local-storage-tech">{{ t.localUpload }}</p>
  </section>
</template>
