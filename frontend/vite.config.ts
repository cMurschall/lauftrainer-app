import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'LaufTrainer',
        short_name: 'LaufTrainer',
        description: 'Lokale Trainingsanalyse und KI-Trainingsplanung',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        lang: 'de'
      }
    })
  ]
})
