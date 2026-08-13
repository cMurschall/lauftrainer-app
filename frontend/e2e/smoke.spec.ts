import { expect, test } from '@playwright/test'

test('app exposes navigation on a mobile-sized viewport', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#app')).toBeVisible()
  await expect(page.locator('body')).toContainText(/LaufTrainer|Dashboard|Analyse/i)
})
