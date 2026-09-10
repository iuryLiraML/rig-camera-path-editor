import { expect, test } from '@playwright/test'

// The static preview has no deployed API functions; exercise the configured-site UI with fixtures.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/agent-config', (route) => route.fulfill({ json: { anthropic: true, fal: false } }))
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { email: 'layout@example.test', loginConfigured: true } }))
})

for (const width of [1884, 1024]) {
  test(`Add Object clears the reopened Director chat at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1061 })
    await page.goto('/#/build')
    await expect(page.getByTitle('Collapse Director')).toBeVisible()
    if (width === 1884) await page.getByRole('button', { name: 'Outliner', exact: true }).click()
    await page.getByTitle('Collapse Director').click()
    await page.getByTitle('Expand Director').click()
    await expect(page.getByTitle('Send (Enter)')).toBeVisible()
    const drawer = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Add an Object', exact: true }) })
    const director = page.locator('.panel').filter({ has: page.getByTitle('Collapse Director') })
    await expect(drawer).toBeVisible()
    await expect.poll(async () => {
      const [tray, chat] = await Promise.all([drawer.boundingBox(), director.boundingBox()])
      return tray && chat ? chat.x - (tray.x + tray.width) : -1
    }).toBeGreaterThanOrEqual(12)
    if (width === 1884) await page.screenshot({ path: testInfo.outputPath('drawer-director-gap.png') })
  })
}

// Compact mode intentionally overlays the viewport; the composer must remain on top.
test('compact chat stays clickable above the Add Object tray', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 600 })
  await page.goto('/#/build')
  await page.getByTitle('Expand Director').click()
  const input = page.getByPlaceholder('Describe a scene, watch AI build it in 3D')
  await input.click()
  await expect(input).toBeFocused()
  await input.fill('Layout fixture draft')
  await page.getByTitle('Collapse Director').click()
  await page.getByTitle('Expand Director').click()
  await expect(input).toHaveValue('Layout fixture draft')
})

test('a compact overlay cannot keep an unreserved width after resizing to desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/#/build')
  await page.getByTitle('Collapse Director').click()
  await page.setViewportSize({ width: 768, height: 600 })
  await page.getByTitle('Expand Director').click()
  await expect(page.getByTitle('Send (Enter)')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByTitle('Expand Director')).toBeVisible()
  await page.getByTitle('Expand Director').click()
  const drawer = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Add an Object', exact: true }) })
  const director = page.locator('.panel').filter({ has: page.getByTitle('Collapse Director') })
  await expect.poll(async () => {
    const [tray, chat] = await Promise.all([drawer.boundingBox(), director.boundingBox()])
    return tray && chat ? chat.x - (tray.x + tray.width) : -1
  }).toBeGreaterThanOrEqual(12)
})
