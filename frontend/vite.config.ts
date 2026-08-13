import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'LaufTrainer',
        short_name: 'LaufTrainer',
        description: 'Lokale Trainingsanalyse und KI-Trainingsplanung',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        lang: 'de',
        icons: [
          {
            src: '/lauftrainer-strava-icon.png',
            sizes: '1280x1280',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/lauftrainer-strava-icon.png',
            sizes: '1280x1280',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ]
})
