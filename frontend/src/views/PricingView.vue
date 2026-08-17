<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '../i18n'
import { redeemVoucher } from '../services/billingService'
import { detectCountry, openTierCheckout, previewTier, tiers, type Tier } from '../services/paddleService'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const ui = useUiStore()
const loading = ref(true)
const error = ref('')
const checkoutTier = ref<string>()
const prices = ref<Record<string, string>>({})
const voucherCode = ref('')
const voucherBusy = ref(false)
const voucherError = ref('')
const voucherSuccess = ref('')

async function loadPrices() {
  loading.value = true
  error.value = ''
  try {
    const detectedCountry = await detectCountry().catch(() => undefined)
    const results = await Promise.all(tiers.map((tier) => previewTier(tier, detectedCountry)))
    prices.value = Object.fromEntries(
      results.map((result, index) => [
        tiers[index].name,
        result.data.details.lineItems[0]?.formattedTotals.total || '',
      ]),
    )
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t.value.pricesLoadFailed
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
    error.value = cause instanceof Error ? cause.message : t.value.checkoutFailed
  } finally {
    checkoutTier.value = undefined
  }
}

async function redeem() {
  voucherBusy.value = true
  voucherError.value = ''
  voucherSuccess.value = ''
  try {
    const balance = await redeemVoucher(voucherCode.value)
    ui.credits = balance
    voucherSuccess.value = t.value.voucherRedeemed.replace('{balance}', String(balance))
    voucherCode.value = ''
  } catch (cause) {
    voucherError.value = cause instanceof Error ? cause.message : t.value.voucherRedeemFailed
  } finally {
    voucherBusy.value = false
  }
}

onMounted(loadPrices)
</script>

<template>
  <main class="pricing-page max-w-md mx-auto flex flex-col justify-center py-8">
    <h1 class="pricing-title">{{ t.creditsTitle }}</h1>
    <p class="pricing-lead">{{ t.creditsLead }}</p>
    <p v-if="error" class="form-error">{{ error }}</p>
    <section class="pricing-grid flex justify-center" aria-live="polite">
      <article v-for="tier in tiers" :key="tier.name" class="card pricing-card">
        <span class="pricing-badge">{{ t.creditsTier }}</span>
        <h2 class="pricing-credits">{{ t.creditsAmount }}</h2>
        <div class="pricing-amount">{{ t.creditsPrice }}</div>
        <ul class="pricing-features">
          <li>{{ t.creditsFeaturePlans }}</li>
          <li>{{ t.creditsFeatureSubscription }}</li>
          <li>{{ t.creditsFeaturePrivacy }}</li>
        </ul>
        <button
          class="button primary pricing-button"
          type="button"
          :disabled="loading || checkoutTier !== undefined"
          @click="subscribe(tier)"
        >
          {{ checkoutTier === tier.name ? t.checkoutOpening : t.creditsBuy }}
        </button>
      </article>
    </section>

    <section class="card pricing-voucher" aria-labelledby="voucher-heading">
      <h2 id="voucher-heading" class="pricing-voucher-title">{{ t.voucherTitle }}</h2>
      <p class="muted pricing-voucher-help">{{ t.voucherHelp }}</p>
      <form class="pricing-voucher-form" @submit.prevent="redeem">
        <input
          v-model="voucherCode"
          type="text"
          autocomplete="off"
          :placeholder="t.voucherPlaceholder"
          :disabled="voucherBusy"
        />
        <button class="button secondary" type="submit" :disabled="voucherBusy || !voucherCode.trim()">
          {{ voucherBusy ? t.voucherRedeeming : t.voucherRedeem }}
        </button>
      </form>
      <p v-if="voucherError" class="form-error">{{ voucherError }}</p>
      <p v-if="voucherSuccess" class="form-success">{{ voucherSuccess }}</p>
    </section>
  </main>
</template>
