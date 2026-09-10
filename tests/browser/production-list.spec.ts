import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/agent-config', (route) => route.fulfill({ json: { anthropic: true, fal: false } }))
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { email: 'production@example.test', loginConfigured: true } }))
})

test('production review persists Library fulfillment and script-removal retention', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/#/home')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await page.getByRole('button', { name: /New project/ }).first().click()
  await page.getByRole('button', { name: /Blank scene Open Build/ }).click()

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rig-db')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('library-palcos', 'readwrite')
      transaction.objectStore('library-palcos').put({
        id: 'asset-hero-browser',
        name: 'Hero library model',
        kind: 'model',
        bufferKey: 'buffer-hero-browser',
        source: 'import',
        format: 'glb',
        createdAt: Date.now(),
        ownerId: 'local',
        collectionId: null,
        tags: [],
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  })

  await page.getByRole('button', { name: 'Production list', exact: true }).click()

  await page.getByRole('button', { name: 'Add requirement', exact: true }).click()
  await page.getByLabel('Requirement name').fill('Hero character')
  await page.getByLabel('Requirement prompt').fill('Consistent lead character')
  await page.getByRole('button', { name: 'Save requirement', exact: true }).click()
  await page.getByRole('button', { name: 'Add requirement', exact: true }).click()
  await page.getByLabel('Requirement name').fill('Cafe chair')
  await page.getByLabel('Requirement prompt').fill('Bentwood chair')
  await page.getByRole('button', { name: 'Save requirement', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Select Hero character' }).check()
  await page.getByRole('checkbox', { name: 'Select Cafe chair' }).check()
  await page.getByRole('button', { name: 'Approve selected', exact: true }).click()
  await page.getByRole('button', { name: 'Hero character', exact: true }).click()
  await page.getByRole('button', { name: '3 3D review', exact: true }).click()
  await page.getByLabel('Library asset').selectOption('asset-hero-browser')
  await page.getByRole('button', { name: 'Use Library asset', exact: true }).click()
  await expect(page.getByText('Fulfilled by Hero library model', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '2 References', exact: true }).click()
  await page.getByLabel('Reference name').fill('Approved hero reference')
  await page.getByLabel('Reference location').fill('library://hero-reference-v1')
  await page.getByRole('button', { name: 'Add reference version', exact: true }).click()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByTitle('Close production list').click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  const projectId = await page.evaluate(async () => {
    const loadModule = (path: string) => import(/* @vite-ignore */ path)
    const [{ useProjectStore }, { reconcileProductionList }, { saveActiveProject }] = await Promise.all([
      loadModule('/src/state/useProjectStore.ts'),
      loadModule('/src/lib/productionWorkflow.ts'),
      loadModule('/src/lib/projects.ts'),
    ])
    const store = useProjectStore.getState()
    const current = store.workflow.production
    const chair = current.items.find((item: { name: string }) => item.name === 'Cafe chair')
    const reconciled = reconcileProductionList(current, {
      revisionId: 'script-v2',
      scenes: [],
      items: [{
        sourceKey: chair.sourceKey,
        sourceFingerprint: chair.sourceFingerprint,
        name: chair.name,
        kind: chair.kind,
        provenance: chair.provenance,
        quantity: chair.quantity,
        sceneSourceKeys: [],
        prompt: chair.prompt,
      }],
    })
    store.setProduction(reconciled.list)
    await saveActiveProject()
    return store.projectId as string
  })
  await page.waitForFunction(async (activeProjectId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rig-db')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const project = await new Promise<{ workflow?: { production?: { items?: Array<{ name: string; requirementStatus: string }> } } } | undefined>((resolve, reject) => {
      const request = db.transaction('projects', 'readonly').objectStore('projects').get(activeProjectId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return project?.workflow?.production?.items?.some(
      (item) => item.name === 'Hero character' && item.requirementStatus === 'no-longer-required',
    ) === true
  }, projectId)

  await page.reload()
  await page.getByRole('button', { name: 'Production list', exact: true }).click()
  await page.getByRole('button', { name: 'No longer required', exact: true }).click()
  await page.getByRole('button', { name: 'Hero character', exact: true }).click()
  await page.getByRole('button', { name: '2 References', exact: true }).click()
  await expect(page.getByText('Approved hero reference', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '3 3D review', exact: true }).click()
  await expect(page.getByText('Fulfilled by Hero library model', { exact: true })).toBeVisible()
  await expect(page.getByText('Assets are never deleted automatically. Remove assets manually from the Library.')).toBeVisible()

  await page.setViewportSize({ width: 760, height: 820 })
  const dialog = await page.getByRole('dialog', { name: 'Production list' }).boundingBox()
  expect(dialog!.width).toBeLessThanOrEqual(760)
  await expect(page.getByRole('button', { name: 'Restore requirement', exact: true })).toBeVisible()
})
