import { expect, test, type Page } from '@playwright/test'

/**
 * Guards a production-only failure mode: Chart.js needs its controllers registered, and a
 * dev server hides a missing registration because the dependency optimizer pulls in
 * `chart.js/auto`. Only the tree-shaken build throws "bar is not a registered controller",
 * which leaves every chart blank.
 */

async function seedLocalWorkouts(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('lauftrainer-local', 6)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const specs: Array<[string, number, number]> = [
      ['Running', 45, 8.5],
      ['Cycling', 90, 32],
      ['Swimming', 40, 0],
    ]
    const workouts = []
    for (let week = 7; week >= 0; week--) {
      for (const [index, spec] of specs.entries()) {
        const [sport, minutes, km] = spec
        const day = new Date(Date.now() - (week * 7 + index) * 86400000)
        const date = day.toISOString().slice(0, 10)
        workouts.push({
          id: `e2e-${sport}-${date}`,
          source: 'unknown',
          name: `${sport} session`,
          sport,
          date,
          durationSeconds: (minutes + week) * 60,
          distanceKm: km ? km + week * 0.4 : undefined,
          averageHeartRate: sport === 'Cycling' ? 132 : 148,
          calories: 400,
          records: [],
          importedAt: new Date().toISOString(),
        })
      }
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['workouts', 'settings', 'analysisCache'], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      for (const workout of workouts) tx.objectStore('workouts').put(workout)
      tx.objectStore('analysisCache').clear()
      // The revision is part of the analysis cache key, so bump it like the app does on writes.
      const revision = tx.objectStore('settings').get('workoutRevision')
      revision.onsuccess = () => {
        tx.objectStore('settings').put(((revision.result as number | undefined) || 0) + 1, 'workoutRevision')
      }
    })
    db.close()
  })
}

function hasVisiblePixels(canvas: ReturnType<Page['locator']>) {
  return canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement
    const context = source.getContext('2d')
    if (!context || !source.width || !source.height) return false
    const { data } = context.getImageData(0, 0, source.width, source.height)
    for (let index = 3; index < data.length; index += 4) if (data[index] > 0) return true
    return false
  })
}

test('draws the weekly analysis chart from local data', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await seedLocalWorkouts(page)
  await page.goto('/analysis')

  const chartCard = page.locator('.analysis-chart-card').first()
  const canvas = chartCard.locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 30000 })
  expect(await hasVisiblePixels(canvas), 'time chart has visible pixels').toBe(true)

  // Swimming is seeded without distance, so switching metrics changes the series set.
  await chartCard.getByRole('button', { name: 'KM', exact: true }).click()
  await expect(canvas).toBeVisible()
  expect(await hasVisiblePixels(canvas), 'distance chart has visible pixels').toBe(true)

  expect(errors.join('\n')).not.toMatch(/not a registered/i)
})
