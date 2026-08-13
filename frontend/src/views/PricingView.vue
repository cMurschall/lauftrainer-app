<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { detectCountry, openTierCheckout, previewTier, tiers, type Tier } from '../services/paddleService'

const router = useRouter()
const country = ref<string>()
const loading = ref(true)
const error = ref('')
const checkoutTier = ref<string>()
const prices = ref<Record<string, string>>({})

async function loadPrices() {
  loading.value = true
  error.value = ''
  try {
    const detectedCountry = await detectCountry().catch(() => undefined)
    country.value = detectedCountry
    const results = await Promise.all(tiers.map((tier) => previewTier(tier, detectedCountry)))
    prices.value = Object.fromEntries(results.map((result, index) => [tiers[index].name, result.data.details.lineItems[0]?.formattedTotals.total || '']))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Preise konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

async function subscribe(tier: Tier) {
  checkoutTier.value = tier.name
  error.value = ''
  try {
    await openTierCheckout(tier, localStorage.getItem('lauftrainer-customer-email') || undefined)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Checkout konnte nicht geöffnet werden.'
  } finally {
    checkoutTier.value = undefined
  }
}

onMounted(loadPrices)
</script>

<template>
  <main class="pricing-page">
    <div class="page-heading">
      <p class="eyebrow">LaufTrainer</p>
      <h1>Wähle deinen Trainingsplan</h1>
      <p class="pricing-lead">Dein persönlicher Trainingscoach — lokal ausgewertet, klar geplant.</p>
      <p class="muted">Ein Credit genügt für einen vollständigen 7-Tage-Trainingsplan.</p>
    </div>
    <p v-if="country" class="muted pricing-country">Preis für {{ country }}</p>
    <p v-if="error" class="form-error">{{ error }}</p>
    <section class="pricing-grid" aria-live="polite">
      <article v-for="tier in tiers" :key="tier.name" class="card pricing-card">
        <div class="pricing-card-topline">
          <p class="eyebrow">{{ tier.name }}</p>
          <span class="pricing-badge">Einmalig</span>
        </div>
        <h2>10 Credits für deine Trainingsplanung</h2>
        <p class="pricing-description">{{ tier.description }}</p>
        <div class="pricing-amount">{{ loading ? '…' : prices[tier.name] || '—' }}</div>
        <p class="pricing-unit">10 KI-Trainingspläne · kein Abo</p>
        <ul><li v-for="feature in tier.features" :key="feature">{{ feature }}</li></ul>
        <button class="button primary pricing-button" type="button" :disabled="loading || checkoutTier !== undefined" @click="subscribe(tier)">{{ checkoutTier === tier.name ? 'Checkout wird geöffnet …' : '10 Credits kaufen' }}</button>
      </article>
    </section>
    <button class="text-button" type="button" @click="router.push('/')">Zurück zum Dashboard</button>
  </main>
</template>
