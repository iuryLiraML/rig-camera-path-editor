import { expect, test, type Page } from '@playwright/test'

async function open(page: Page, mode: 'build' | 'compose' | 'visualize') {
  await page.goto('/#/build')
  await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: mode[0].toUpperCase() + mode.slice(1), exact: true }).click()
  await page.waitForTimeout(300)
}

async function unreachable(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) => elements.flatMap((el) => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return []
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return hit && (hit === el || el.contains(hit)) ? [] : [el.getAttribute('title') || el.textContent]
  }))
}

for (const width of [768, 1024, 1440]) {
  test(`Compose footer and onboarding stay reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    await open(page, 'compose')
    await page.evaluate(async () => {
      const { useSceneStore } = await import('/src/state/useSceneStore.ts')
      useSceneStore.setState({ onboardingDismissed: false })
    })
    await expect(page.getByRole('heading', { name: 'Frame a camera fly-through' })).toBeVisible()
    expect(await unreachable(page, '[data-viewport-footer] button,[data-viewport-footer] select,button[title="Close"]')).toEqual([])
    const text = page.getByText('No camera path yet', { exact: true })
    const rect = await text.boundingBox()
    expect(rect!.width).toBeGreaterThan(120)
    if (await page.getByRole('button', { name: 'Views', exact: true }).count()) {
      await page.getByRole('button', { name: 'Views', exact: true }).click()
      expect(await unreachable(page, '[data-viewport-footer] button')).toEqual([])
      await page.getByRole('button', { name: 'Top', exact: true }).click()
    }
  })

  test(`Visualize exports and pass picker stay reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    await open(page, 'visualize')
    // Explicitly enabled Free camera: a still camera is a valid export source.
    await page.evaluate(async () => {
      const { useRigStore } = await import('/src/state/useRigStore.ts')
      useRigStore.setState({ cameraKind: 'static' })
    })
    const actions = '[data-visualize-bar] button'
    expect(await unreachable(page, `${actions}:has-text("Export")`)).toEqual([])
    await expect(page.getByRole('button', { name: 'Export frame', exact: true })).toBeEnabled()
    const passes = page.getByTitle('Passes included in the export')
    await passes.scrollIntoViewIfNeeded()
    await passes.click()
    const toggle = page.getByRole('button', { name: 'Depth', exact: true }).last()
    await expect(toggle).toBeVisible()
    await toggle.click()
    expect(await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/state/useEditorStore.ts')
      return useEditorStore.getState().exportPasses.includes('depth')
    })).toBe(true)
  })
}

test('compact Director opens chat and retains a draft across collapse', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 700 })
  await open(page, 'compose')
  await page.getByTitle('Expand Director').click()
  const input = page.getByPlaceholder('Ask the Director to block a shot…')
  await expect(input).toBeVisible()
  await input.fill('draft for later')
  await page.getByTitle('Collapse Director').click()
  await page.getByTitle('Expand Director').click()
  await expect(input).toHaveValue('draft for later')
})


test('export actions reject an incomplete path and accept a Free camera', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await open(page, 'visualize')
  const frame = page.getByRole('button', { name: 'Export frame', exact: true })
  await expect(frame).toBeDisabled()
  await expect(frame).toHaveAttribute('title', /two path points/)
  await page.evaluate(async () => {
    const { useRigStore } = await import('/src/state/useRigStore.ts')
    useRigStore.setState({ cameraKind: 'static' })
  })
  await expect(frame).toBeEnabled()
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/useEditorStore.ts')
    useEditorStore.setState({ exportPasses: [] })
  })
  await expect(frame).toBeDisabled()
  await expect(frame).toHaveAttribute('title', /at least one/)
})
