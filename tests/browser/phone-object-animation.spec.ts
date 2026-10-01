import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test('phone Build makes object insertion and object keyframe curves reachable', async ({ page }, info) => {
  await page.goto('/')
  // Wait for persisted project state to finish booting before seeding the editor view.
  await expect(page.getByRole('heading', { name: 'Welcome to Rig' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /New project Start with AI/ }).click()
  await page.getByRole('button', { name: /^Blank scene/ }).click()
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Add', exact: true }).tap()
  await expect(page.getByRole('heading', { name: 'Add an Object' })).toBeVisible()
  await page.getByRole('button', { name: 'Primitives', exact: true }).tap()
  await page.locator('[data-primitive="box"]').tap()

  await page.getByRole('button', { name: 'Animate', exact: true }).tap()
  await expect(page.getByRole('heading', { name: 'Animate an object' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Scene object' })).toHaveValue(/.+/)

  await page.getByRole('button', { name: /Add a position keyframe at the playhead/i }).tap()
  const playhead = page.getByRole('slider', { name: 'Animation playhead' })
  const playheadBox = await playhead.boundingBox()
  expect(playheadBox).not.toBeNull()
  await page.touchscreen.tap(playheadBox!.x + playheadBox!.width - 2, playheadBox!.y + playheadBox!.height / 2)
  await page.getByRole('button', { name: /Add a position keyframe at the playhead/i }).tap()
  await page.getByRole('button', { name: /Position.*0\.00s/ }).tap()
  await page.getByRole('combobox', { name: 'Curve preset' }).selectOption('cubicOut')
  const firstHandle = page.getByRole('slider', { name: 'First handle time' })
  await firstHandle.scrollIntoViewIfNeeded()
  const handleBox = await firstHandle.boundingBox()
  expect(handleBox).not.toBeNull()
  await firstHandle.click({ position: { x: handleBox!.width / 2, y: handleBox!.height / 2 } })

  await expect(page.getByRole('img', { name: 'Animation curve preview' })).toBeVisible()
  const result = await page.evaluate(() => {
    const object = window.__stores.scene.getState().objects.find((item) => item.name === 'Box')
    if (!object) throw new Error('The inserted Box is missing from the rendered scene store')
    return object.keys.map((key) => ({ channel: key.channel, time: key.time, ease: key.ease, bezier: key.easeBezier }))
  })
  expect(result).toHaveLength(2)
  expect(result[0].channel).toBe('position')
  expect(result[0].ease).toBe('cubicOut')
  expect(result[0].bezier?.[0]).toBeCloseTo(0.5, 1)
  expect(result[1].time).toBe(1)

  const sheet = await page.locator('[data-phone-task-sheet]').boundingBox()
  expect(sheet).not.toBeNull()
  expect(sheet!.x).toBeGreaterThanOrEqual(0)
  expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: info.outputPath('phone-object-curve.png') })

  await page.setViewportSize({ width: 360, height: 800 })
  const narrowSheet = await page.locator('[data-phone-task-sheet]').boundingBox()
  expect(narrowSheet).not.toBeNull()
  expect(narrowSheet!.x).toBeGreaterThanOrEqual(0)
  expect(narrowSheet!.x + narrowSheet!.width).toBeLessThanOrEqual(360)
  await expect(page.getByRole('slider', { name: 'First handle time' })).toBeVisible()
})
