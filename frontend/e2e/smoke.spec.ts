import { expect, test } from '@playwright/test'

test('app exposes navigation on a mobile-sized viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('#app')).toBeVisible()
  await expect(page.locator('body')).toContainText(/LaufTrainer|Dashboard|Analyse/i)
  await expect(page.locator('.sidebar .nav, nav.nav')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow).toBe(false)
})
