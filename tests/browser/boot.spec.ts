import { expect, test, type Page } from '@playwright/test'

/**
 * A module-level error takes the whole app down: React never mounts, the last
 * painted frame stays on screen and nothing responds. Every symptom then points
 * at whatever the user was trying to do — a stale `isTechMode` import read for
 * hours as a dead Pen tool. These specs name the real cause in one line.
 *
 * `pageerror` is uncaught JS only. Failed *requests* are deliberately not fatal:
 * the dev server 403s the hoisted Inter woff2 outside its fs allow list, which
 * is cosmetic and predates this suite.
 */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

/**
 * Settle on whichever comes first, a mounted app or a thrown module, then let
 * the caller assert. Waiting on the chrome alone reports a 30s timeout about
 * the wrong subject; this reports the exception text.
 */
async function settleBoot(page: Page, errors: string[]) {
  await expect
    .poll(
      async () =>
        errors.length > 0 ||
        (await page.evaluate(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 1000)),
      { timeout: 30_000 },
    )
    .toBe(true)
  expect(errors).toEqual([])
}

test.describe('the app boots', () => {
  test('mounts React with no uncaught module error', async ({ page }) => {
    const errors = collectPageErrors(page)

    await page.goto('/#/build')
    await settleBoot(page, errors)

    await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 30_000 })
  })

  test('Skip on Welcome opens Home tiles', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto('/')
    await settleBoot(page, errors)
    await page.getByRole('button', { name: 'Skip' }).click()
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^New project Start with AI/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Import assets/ })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Workspaces' })).toBeVisible()
    await expect(page.getByText('Generate 3D')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('arms a crosshair on the canvas when the Pen is picked', async ({ page }) => {
    const errors = collectPageErrors(page)

    await page.goto('/#/build')
    await settleBoot(page, errors)
    await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(async () => {
      const mod = await import('/src/state/useEditorStore.ts')
      mod.useEditorStore.getState().setWorkspaceMode('compose')
    })

    const canvasCursor = () =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector('canvas') as HTMLCanvasElement).cursor,
      )
    expect(await canvasCursor()).toBe('auto')

    await page.getByTitle('Pen — click to place path points (P)').click()

    // The only on-screen answer to "is the Pen armed?" before the first move.
    await expect.poll(canvasCursor).toBe('crosshair')
    expect(errors).toEqual([])
  })
})

const COMPACT = { width: 768, height: 600 }

test.describe('Home at compact 768×600', () => {
  test.use({ viewport: COMPACT })

  test('Skip opens Home and the four tiles wrap', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto('/')
    await settleBoot(page, errors)
    await page.getByRole('button', { name: 'Skip' }).click()
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    const newProject = page.getByRole('button', { name: /^New project Start with AI/ })
    const projects = page.getByRole('button', { name: /document list/ })
    const top = await newProject.boundingBox()
    const wrapped = await projects.boundingBox()
    expect(top && wrapped).toBeTruthy()
    expect(wrapped!.y).toBeGreaterThan(top!.y + 24)
    expect(errors).toEqual([])
  })

  test('Back to Home chip returns to Home', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto('/')
    await settleBoot(page, errors)
    await page.getByRole('button', { name: 'Skip' }).click()
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await page.goto('/#/build')
    await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 30_000 })
    await page.getByTitle('Back to Home').click()
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
})
