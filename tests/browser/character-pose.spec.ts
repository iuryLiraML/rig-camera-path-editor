import { expect, test } from '@playwright/test'

test('Figure sliders preserve a pose through clip playback and project reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/agent-config', (route) => route.fulfill({ json: { anthropic: false, fal: false } }))
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { email: 'pose@example.test', loginConfigured: true } }))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/#/build')
  await page.getByRole('button', { name: 'Figures', exact: true }).click()
  await page.locator('button[data-primitive="male"]').click()
  const slider = page.getByRole('slider', { name: 'Left forearm Bend', exact: true })
  await expect(slider).toBeVisible()
  await slider.fill('90')
  await slider.press('Tab')
  await page.getByRole('button', { name: 'Play clip', exact: true }).click()
  await page.getByLabel('Character clip', { exact: true }).selectOption('Walk')
  await page.getByRole('button', { name: 'Edit pose', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Left forearm Bend degrees' })).toHaveValue('90')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.reload()
  // Selection is transient; select the retained Figure from the scene list.
  await page.getByRole('button', { name: 'Outliner', exact: true }).click()
  await page.getByText('Male', { exact: true }).first().click()
  await expect(page.getByRole('spinbutton', { name: 'Left forearm Bend degrees' })).toHaveValue('90')
  await expect(page.getByLabel('Advanced joint handles')).not.toBeChecked()
  await page.screenshot({ path: '/tmp/rig-character-pose.png' })
  expect(errors).toEqual([])
})
