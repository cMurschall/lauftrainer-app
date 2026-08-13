import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/analysis/**/*.ts', 'src/parsers/**/*.ts', 'src/db/**/*.ts', 'src/services/**/*.ts'],
      exclude: ['**/*.test.ts', '**/analysisWorker.ts'],
      thresholds: { lines: 60, functions: 60, statements: 60, branches: 50 },
    },
  },
})
