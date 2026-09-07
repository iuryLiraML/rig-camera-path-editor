import { expect, test, type Page } from '@playwright/test'

// WebKit: npm run webkit:libs, then npm run test:browser:webkit.
// WebKit coverage complements real Safari checks on macOS.

/** Spec sizes from issue #6 — not imported from chromeLayout (Playwright is not a fifth source of truth). */
const FULL = { width: 1024, height: 700 }
const COMPACT = { width: 768, height: 600 }

async function openEditor(page: Page) {
  await page.goto('/')
  await expect(page.getByTitle('Back to projects')).toBeVisible({ timeout: 30_000 })
}

async function expectPersistentChrome(page: Page) {
  await expect(page.getByTitle('Back to projects')).toBeVisible()
  await expect(page.getByTitle('Account')).toBeVisible()
  await expect(page.getByText('Director', { exact: true })).toBeVisible()
  await expect(page.getByTitle('Place objects in the scene')).toBeVisible()
  await expect(page.getByTitle('Frame shots and edit the camera')).toBeVisible()
  await expect(page.getByTitle('Generate a reference from a prompt')).toBeVisible()
  await expect(page.getByTitle('Select (V)')).toBeVisible()
  await expect(page.getByTitle('Undo (Ctrl+Z)')).toBeVisible()
  await expect(page.getByTitle('Redo (Ctrl+Shift+Z)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible()
  await expect(
    page
      .getByRole('button', { name: 'Create a path first' })
      .or(page.getByRole('button', { name: 'Fullscreen preview (hides panels)' })),
  ).toBeVisible()
}

/**
 * The account popover is a `role="menu"`, like the scene and project-card menus,
 * so its entries expose `menuitem` — never `button`. Asking for a button here
 * matched nothing and read as a missing control rather than a wrong query.
 */
async function expectDisconnectedAccount(page: Page) {
  await page.getByTitle('Account').click()
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0)
}

test.describe('critical editor chrome at full 1024×700', () => {
  test.use({ viewport: FULL })

  test('Projects, Account, modes, and compact-priority controls stay visible', async ({ page }) => {
    await openEditor(page)
    await expectPersistentChrome(page)
    await expect(page.getByTitle('More')).toHaveCount(0)
  })

  test('Account offers Settings without Sign out on a disconnected session', async ({ page }) => {
    await openEditor(page)
    await expectDisconnectedAccount(page)
  })

  test('Director starts expanded and collapse keeps the inspector', async ({ page }) => {
    await openEditor(page)
    await expect(page.getByTitle('Collapse Director')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Settings' })).toBeVisible()
    await expect(page.getByText('Select an object or path')).toBeVisible()

    await page.getByTitle('Collapse Director').click()
    await expect(page.getByTitle('Expand Director')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Settings' })).toHaveCount(0)
    await expect(page.getByTitle('Send (Enter)')).toHaveCount(0)
    await expect(page.getByText('Select an object or path')).toBeVisible()

    await page.getByTitle('Expand Director').click()
    await expect(page.getByTitle('Collapse Director')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Settings' })).toBeVisible()
  })
})

test.describe('critical editor chrome at compact 768×600', () => {
  test.use({ viewport: COMPACT })

  test('Projects, Account, modes, and compact-priority controls stay visible', async ({ page }) => {
    await openEditor(page)
    await expectPersistentChrome(page)
    await expect(page.getByTitle('More')).toBeVisible()
    await expect(page.getByTitle('Move (W)')).toHaveCount(0)
    await expect(page.getByTitle('Center the view on the world origin (H)')).toHaveCount(0)
  })

  test('Account offers Settings without Sign out on a disconnected session', async ({ page }) => {
    await openEditor(page)
    await expectDisconnectedAccount(page)
  })

  test('compact Director opens an explicit chat overlay on Expand', async ({ page }) => {
    await openEditor(page)
    await expect(page.getByTitle('Expand Director')).toBeVisible()
    await expect(page.getByTitle('Collapse Director')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open Settings' })).toHaveCount(0)
    await expect(page.getByTitle('Send (Enter)')).toHaveCount(0)
    await expect(page.getByText('Select an object or path')).toBeVisible()

    await page.getByTitle('Expand Director').click()
    await expect(page.getByTitle('Collapse Director')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Settings' })).toBeVisible()
    await expect(page.getByPlaceholder('Describe a scene, watch AI build it in 3D')).toBeVisible()
  })
})
