<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()
</script>
<template>
  <main class="pricing-page">
    <section class="card welcome-card">
      <p class="eyebrow">LaufTrainer</p>
      <h1>Willkommen!</h1>
      <p class="muted">Dein Checkout wurde abgeschlossen. Dein Plan ist jetzt bereit.</p>
      <button class="button primary" type="button" @click="router.push('/')">Zum Dashboard</button>
    </section>
  </main>
</template>
