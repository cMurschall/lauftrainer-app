import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  optimizeDeps: {
    // Keep MapLibre's ESM worker out of the prebundle so setWorkerUrl(?worker&url) works in Firefox.
    exclude: ['maplibre-gl'],
  },
  plugins: [
    tailwindcss(),
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // PMTiles are Range-read from R2; never let the service worker cache the archive.
        navigateFallbackDenylist: [/\.pmtiles($|\?)/i],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.toLowerCase().endsWith('.pmtiles'),
            handler: 'NetworkOnly',
          },
        ],
      },
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
