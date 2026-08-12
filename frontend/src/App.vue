<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { calculateAnalysis } from './analysis/localAnalysis'
import { exportBackup, importBackup, workoutDb } from './db/database'
import { importWorkoutFile } from './services/importService'
import { requestTrainingPlan } from './services/aiService'
import type { TrainingPlanDay, UserConfig, Workout } from './types/workout'

const workouts = ref<Workout[]>([])
const plan = ref<TrainingPlanDay[]>([])
const message = ref('')
const loading = ref(false)
const consent = ref(false)
const search = ref('')
const config = ref<UserConfig>({ name: 'Athlet', trainingFocus: 'base_endurance', preferredTrainingDays: ['monday', 'wednesday', 'friday'], hrZones: { z1: [90, 106], z2: [107, 124], z3: [125, 142], z4: [143, 160], z5: [161, 179] }, thresholds: { lthr: 160, hr_max: 186 } })
const analysis = computed(() => calculateAnalysis(workouts.value, config.value))
const filteredWorkouts = computed(() => workouts.value.filter(workout => `${workout.name} ${workout.sport} ${workout.date}`.toLowerCase().includes(search.value.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date)))

onMounted(async () => { workouts.value = await workoutDb.list(); const stored = await workoutDb.getConfig(); if (stored) config.value = stored })

async function importFiles(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || [])
  let imported = 0
  for (const file of files) {
    try { await importWorkoutFile(file); imported += 1 } catch (error) { message.value = error instanceof Error ? error.message : 'Import fehlgeschlagen.' }
  }
  workouts.value = await workoutDb.list()
  if (imported) message.value = `${imported} Datei(en) lokal verarbeitet.`
}

async function createPlan() {
  if (!consent.value) { message.value = 'Bitte bestätige zuerst die Übertragung der Zusammenfassung.'; return }
  loading.value = true
  try { plan.value = await requestTrainingPlan(workouts.value, config.value); await workoutDb.savePlan(plan.value); message.value = 'Trainingsplan lokal gespeichert.' }
  catch (error) { message.value = error instanceof Error ? error.message : 'KI-Aufruf fehlgeschlagen.' }
  finally { loading.value = false }
}

async function saveConfig() { await workoutDb.saveConfig(config.value); message.value = 'Einstellungen lokal gespeichert.' }
async function downloadBackup() { const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `lauftrainer-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); message.value = 'Backup exportiert.' }
async function restoreBackup(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { await importBackup(JSON.parse(await file.text())); workouts.value = await workoutDb.list(); message.value = 'Backup wiederhergestellt.' } catch (error) { message.value = error instanceof Error ? error.message : 'Backup konnte nicht gelesen werden.' } }
async function clearData() { if (!window.confirm('Alle lokalen Trainingsdaten löschen?')) return; await workoutDb.deleteAll(); workouts.value = []; plan.value = []; message.value = 'Lokale Trainingsdaten gelöscht.' }
</script>

<template>
  <main class="shell">
    <header><div><p class="eyebrow">LOKALER TRAININGSCOACH</p><h1>LaufTrainer</h1></div><span class="badge">Offline bereit</span></header>
    <section class="hero"><div><h2>Deine Daten bleiben auf deinem Gerät.</h2><p>Importiere Polar-Exporte, analysiere deine Historie lokal und fordere bei Bedarf einen KI-Plan an.</p></div><label class="button primary">Dateien importieren<input type="file" multiple accept=".csv,.json,.tcx" @change="importFiles"></label></section>
    <p v-if="message" class="notice">{{ message }}</p>
    <section class="stats"><article class="card"><span>Workouts</span><strong class="metric">{{ workouts.length }}</strong></article><article class="card"><span>Distanz gesamt</span><strong class="metric">{{ analysis.totalDistanceKm.toFixed(1) }} km</strong></article><article class="card"><span>Trainingszeit</span><strong class="metric">{{ Math.round(analysis.totalDurationMinutes / 60) }} h</strong></article></section>
    <section class="grid"><article class="card"><p class="eyebrow">TRAININGSHISTORIE</p><input v-model="search" class="search" placeholder="Workouts suchen …"><ul class="workouts"><li v-for="workout in filteredWorkouts.slice(0, 12)" :key="workout.id"><strong>{{ workout.date }}</strong><span>{{ workout.sport }} · {{ Math.round(workout.durationSeconds / 60) }} min · {{ workout.distanceKm?.toFixed(1) || '–' }} km</span></li><li v-if="!filteredWorkouts.length">Noch keine passenden Workouts.</li></ul></article>
      <article class="card"><p class="eyebrow">WOCHENÜBERSICHT</p><div class="weeks"><div v-for="week in analysis.weekly.slice(-8).reverse()" :key="week.weekStart"><strong>{{ week.weekStart }}</strong><span>{{ week.distanceKm.toFixed(1) }} km · {{ week.workoutCount }} Einheiten</span><i :style="{ width: `${Math.min(100, week.distanceKm * 3)}%` }"></i></div><p v-if="!analysis.weekly.length">Nach dem Import erscheinen hier deine Wochenwerte.</p></div></article></section>
    <section class="card"><p class="eyebrow">DATEN UND EINSTELLUNGEN</p><div class="settings"><label>Name<input v-model="config.name" @change="saveConfig"></label><label>LTHR<input v-model.number="config.thresholds.lthr" type="number" @change="saveConfig"></label><button class="button secondary" @click="downloadBackup">Backup exportieren</button><label class="button secondary">Backup importieren<input type="file" accept=".json" @change="restoreBackup"></label><button class="text-button" @click="clearData">Lokale Daten löschen</button></div></section>
    <section class="card"><p class="eyebrow">KI-TRAININGSPLAN</p><p>Nur die verdichtete Zusammenfassung wird nach Zustimmung an das KI-Backend übertragen.</p><label class="consent"><input v-model="consent" type="checkbox"> Ich stimme diesem KI-Aufruf zu.</label><button class="button primary full" :disabled="loading || !workouts.length" @click="createPlan">{{ loading ? 'Plan wird erstellt …' : 'Plan erstellen' }}</button><div v-if="plan.length" class="plan"><div v-for="day in plan" :key="day.day"><strong>{{ day.day }}</strong><span>{{ day.description }} · {{ day.total_duration_minutes }} min</span></div></div></section>
    <footer><span>IndexedDB · kein automatischer Upload</span></footer>
  </main>
</template>
