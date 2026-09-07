import { expect, test } from '@playwright/test'

test('the recovered session endpoint serves JSON through the dev adapter', async ({ request }) => {
  const response = await request.get('/api/auth/me')
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.email).toBeNull()
  expect(typeof body.loginConfigured).toBe('boolean')
  expect(response.headers()['cache-control']).toBe('no-store')
})

test('Account recognizes the site login without requiring a cloud token', async ({ page }) => {
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { email: 'browser-fixture@silverside.ai', loginConfigured: true } }))
  await page.goto('/')
  await page.getByTitle('Account', { exact: true }).click()
  await expect(page.getByText('browser-fixture@silverside.ai', { exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible()
  await expect(page.getByText('Not signed in', { exact: true })).toHaveCount(0)
})

test('sign-in navigation flushes an edited draft before leaving the editor', async ({ page }) => {
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { email: null, loginConfigured: true } }))
  await page.route('**/api/auth/login', (route) => route.fulfill({ contentType: 'text/html', body: '<p>OAuth navigation fixture</p>' }))
  await page.goto('/')
  await page.getByTitle('Account', { exact: true }).click()
  await page.evaluate(async () => {
    const { useSceneStore } = await import('/src/state/useSceneStore.ts')
    useSceneStore.getState().addPrimitive('box')
  })
  await page.getByRole('menuitem', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/api\/auth\/login$/)
  const objects = await page.evaluate(async () => {
    const { idbGetAll, STORES } = await import('/src/lib/idb.ts')
    const records = await idbGetAll(STORES.projects)
    return records.map((r: any) => r.scenes[0].sceneMeta.length)
  })
  expect(objects).toEqual([1])
})
