import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/sample-run.tcx')

test.describe('local-first roundtrip', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium-only in v1')

  test('imports a workout, shows analysis, then backup/clear/restore', async ({ page }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept()
    })

    await page.goto('/settings')
    await expect(page.getByRole('button', { name: /Dateien importieren|Import files/i })).toBeVisible()

    const workoutInput = page.locator('input[type="file"][accept*=".tcx"]')
    await workoutInput.setInputFiles(fixture)

    await expect(page.locator('.local-data-grid, .settings-card, section').filter({ hasText: /Workouts|workouts/i }).first()).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByText(/1/).first()).toBeVisible()

    // Analysis should render after import.
    await page.goto('/analysis')
    await expect(page.locator('.analysis-chart-card canvas, canvas').first()).toBeVisible({ timeout: 30000 })

    // Export backup
    await page.goto('/settings')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Backup exportieren|Export backup/i }).click()
    const download = await downloadPromise
    const backupPath = path.join(test.info().outputDir, 'backup.json')
    await download.saveAs(backupPath)

    // Clear local workouts (and other selected defaults)
    await page.getByRole('button', { name: /Lokale Daten löschen|Delete local data/i }).click()
    await page.getByRole('button', { name: /Auswahl löschen|Delete selection/i }).click()

    await expect.poll(async () => {
      return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('lauftrainer-local', 6)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const count = await new Promise<number>((resolve, reject) => {
          const tx = db.transaction('workouts', 'readonly')
          const req = tx.objectStore('workouts').count()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        })
        db.close()
        return count
      })
    }).toBe(0)

    // Restore backup
    const backupInput = page.locator('input[type="file"][accept=".json"]')
    await backupInput.setInputFiles(backupPath)

    await expect.poll(async () => {
      return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('lauftrainer-local', 6)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const count = await new Promise<number>((resolve, reject) => {
          const tx = db.transaction('workouts', 'readonly')
          const req = tx.objectStore('workouts').count()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        })
        db.close()
        return count
      })
    }).toBe(1)

    await page.goto('/analysis')
    await expect(page.locator('.analysis-chart-card canvas, canvas').first()).toBeVisible({ timeout: 30000 })
  })
})
