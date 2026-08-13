<script lang="ts" setup>
import { computed, ref } from 'vue'
import { type Locale, useI18n } from '../i18n'
import UiSelect from '../components/UiSelect.vue'
import type { TrainingPlanDay, UserConfig, Workout } from '../types/workout'
import type { ConnectorId, ConnectorSettings, ThemePreference, TrainingGoal, GoalType } from '../types/settings'

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
  disconnectConnector: (id: ConnectorId) => void
  goals: TrainingGoal[]
  workouts: Workout[]
  plan: TrainingPlanDay[]
  saveGoal: (goal: TrainingGoal) => void
  deleteGoal: (id: string) => void
}>()
const emit = defineEmits<{ 'update:theme': [value: ThemePreference]; 'update:locale': [value: Locale] }>()
const { locale, t, setLocale } = useI18n()
const showGoalForm = ref(false)
const editingGoalId = ref<string | null>(null)
const goalType = ref<GoalType>('personal')
const goalForm = ref({ title: '', date: '', sport: 'Running', distanceKm: undefined as number | undefined, targetTime: '', targetPace: '', priority: 'B' as 'A' | 'B' | 'C', notes: '' })
const goalError = ref('')
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const weekdayLabels = computed(() => ({ monday: t.value.monday, tuesday: t.value.tuesday, wednesday: t.value.wednesday, thursday: t.value.thursday, friday: t.value.friday, saturday: t.value.saturday, sunday: t.value.sunday }))
const sortedGoals = computed(() => [...props.goals].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')))
const workoutDateRange = computed(() => {
  const dates = props.workouts.map((workout) => workout.date.slice(0, 10)).sort()
  if (!dates.length) return t.value.noLocalWorkouts
  const format = (date: string) => new Intl.DateTimeFormat(locale.value, { month: '2-digit', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
  return `${format(dates[0])} – ${format(dates[dates.length - 1])}`
})
const localDataSize = computed(() => {
  const data = JSON.stringify({ workouts: props.workouts, goals: props.goals, plan: props.plan })
  const bytes = new TextEncoder().encode(data).length
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
})
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
const trainingGoalOptions = computed(() => [
  { label: t.value.goalBaseEndurance, value: 'base_endurance' },
  { label: t.value.goalPerformance, value: 'performance' },
  { label: t.value.goalRecovery, value: 'recovery' },
  { label: t.value.goalGeneralFitness, value: 'general_fitness' },
])

function changeLocale(value: Locale) {
  setLocale(value)
  emit('update:locale', value)
}

function togglePreferredDay(day: string) {
  props.config.preferredTrainingDays = props.config.preferredTrainingDays.includes(day)
    ? props.config.preferredTrainingDays.filter((item) => item !== day)
    : [...props.config.preferredTrainingDays, day]
  props.saveConfig()
}

function changeTrainingGoal(value: string) {
  props.config.trainingGoal = value
  props.saveConfig()
}

function resetGoalForm() {
  goalForm.value = { title: '', date: '', sport: 'Running', distanceKm: undefined, targetTime: '', targetPace: '', priority: 'B', notes: '' }
  goalType.value = 'personal'
  goalError.value = ''
  editingGoalId.value = null
}

function editGoal(goal: TrainingGoal) {
  editingGoalId.value = goal.id
  goalType.value = goal.type
  goalForm.value = { title: goal.title, date: goal.date || '', sport: goal.sport || 'Running', distanceKm: goal.distanceKm, targetTime: goal.targetTime || '', targetPace: goal.targetPace || '', priority: goal.priority || 'B', notes: goal.notes || '' }
  goalError.value = ''
  showGoalForm.value = true
}

function submitGoal() {
  if (!goalForm.value.title.trim() || (goalType.value === 'race' && !goalForm.value.date)) {
    goalError.value = t.value.goalRequired
    return
  }
  props.saveGoal({
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
      ><label>{{ t.lthr }}<input v-model.number="config.thresholds.lthr" type="number" @change="saveConfig" /><span class="field-help">{{ t.lthrHelp }}</span></label>
      <label>{{ t.trainingGoal }}<UiSelect :model-value="config.trainingGoal || config.trainingFocus || 'base_endurance'" :ariaLabel="t.trainingGoal" :options="trainingGoalOptions" @update:model-value="changeTrainingGoal" /></label>
      <label>{{ t.performanceNotes }}<textarea v-model="config.performanceNotes" rows="3" @change="saveConfig"></textarea></label>
      <label>{{ t.limitations }}<textarea v-model="config.limitations" rows="3" @change="saveConfig"></textarea></label>
      <label>{{ t.personalNotes }}<textarea v-model="config.personalNotes" rows="3" @change="saveConfig"></textarea></label>
    </div>
  </section>
  <section class="card settings-section">
    <p class="eyebrow">{{ t.trainingFramework }}</p>
    <div class="form-grid">
      <label>{{ t.trainingFrequency }}<input v-model.number="config.trainingFrequencyPerWeek" min="0" max="14" step="1" type="number" @change="saveConfig" /></label>
      <label class="checkbox-field"><input v-model="config.strengthTraining" type="checkbox" @change="saveConfig" />{{ t.strengthTraining }}</label>
      <label>{{ t.maxWeeklyMinutes }}<input v-model.number="config.maxWeeklyTrainingMinutes" min="1" step="15" type="number" placeholder="optional" @change="saveConfig" /></label>
    </div>
    <p class="field-heading">{{ t.preferredDays }}</p>
    <div class="weekday-picks">
      <label v-for="day in weekdays" :key="day" class="checkbox-field">
        <input :checked="config.preferredTrainingDays.includes(day)" type="checkbox" @change="togglePreferredDay(day)" />{{ weekdayLabels[day] }}
      </label>
    </div>
    <p class="field-heading">{{ t.maxDailyMinutes }}</p>
    <p class="field-help settings-help">{{ t.trainingLimitsHelp }}</p>
    <div class="daily-limits">
      <label v-for="day in weekdays" :key="day">{{ weekdayLabels[day] }}<input v-model.number="config.maxTrainingMinutesPerDay![day]" min="1" step="15" type="number" placeholder="optional" @change="saveConfig" /></label>
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
        <button class="button" :class="goalType === 'personal' ? 'primary' : 'secondary'" type="button" @click="goalType = 'personal'">{{ t.personalGoal }}</button>
        <button class="button" :class="goalType === 'race' ? 'primary' : 'secondary'" type="button" @click="goalType = 'race'">{{ t.race }}</button>
      </div>
      <div class="form-grid">
        <label>{{ t.goalTitle }} *<input v-model="goalForm.title" required /></label>
        <label>{{ t.goalDate }}<input v-model="goalForm.date" :required="goalType === 'race'" type="date" /></label>
        <label>{{ t.goalSport }}<input v-model="goalForm.sport" /></label>
        <label>{{ t.goalDistance }}<input v-model.number="goalForm.distanceKm" min="0" step="0.1" type="number" /></label>
        <label>{{ t.targetTime }}<input v-model="goalForm.targetTime" placeholder="z. B. 1:45:00" /></label>
        <label>{{ t.targetPace }}<input v-model="goalForm.targetPace" placeholder="z. B. 5:00 min/km" /></label>
        <label v-if="goalType === 'race'">{{ t.priority }}<UiSelect v-model="goalForm.priority" :ariaLabel="t.priority" :options="[{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }, { label: 'C', value: 'C' }]" /></label>
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
        <button class="text-button" type="button" :aria-label="t.editGoal" @click="editGoal(goal)">{{ t.editGoal }}</button>
        <span v-if="goal.targetTime || goal.targetPace || goal.priority" class="goal-target">
          <template v-if="goal.priority">{{ goal.priority }}</template><template v-if="goal.targetTime"> · {{ goal.targetTime }}</template><template v-if="goal.targetPace"> · {{ goal.targetPace }}</template>
        </span>
        <div class="goal-date">{{ goal.date ? new Date(`${goal.date}T12:00:00`).toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }}</div>
        <div class="goal-copy"><strong>{{ goal.title }}</strong><span>{{ goal.type === 'race' ? t.race : t.personalGoal }}<template v-if="goal.sport"> · {{ goal.sport }}</template><template v-if="goal.distanceKm"> · {{ goal.distanceKm }} km</template><template v-if="goal.target"> · {{ goal.target }}</template></span></div>
        <button class="text-button" type="button" :aria-label="t.deleteGoal" @click="deleteGoal(goal.id)">×</button>
      </article>
    </div>
    <p v-else class="muted">{{ t.noGoals }}</p>
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
          <button v-else class="button secondary" @click="disconnectConnector(connector.id)">
            Trennen
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
    <div class="local-data-summary">
      <div>
        <strong>{{ props.workouts.length }}</strong>
        <span>{{ t.localWorkouts }}</span>
      </div>
      <div>
        <strong>{{ workoutDateRange }}</strong>
        <span>{{ t.localPeriod }}</span>
      </div>
      <div>
        <strong>{{ props.goals.length }} · {{ props.plan.length }}</strong>
        <span>{{ t.localGoalsAndPlan }}</span>
      </div>
      <div>
        <strong>~{{ localDataSize }}</strong>
        <span>{{ t.localStorageUsed }}</span>
      </div>
    </div>
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
