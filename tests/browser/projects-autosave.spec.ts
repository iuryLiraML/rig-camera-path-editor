import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
})

test('renaming another project card persists its title before opening it', async ({ page }) => {
  await page.goto('/#/build')
  await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 45_000 })
  const ids = await page.evaluate(async () => {
    const { createProject } = await import('/src/lib/projects.ts')
    const target = await createProject('Card rename fixture')
    const current = await createProject('Current fixture')
    return { target, current }
  })
  await page.getByTitle('Back to Home').click()
  await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  const card = page.locator('div.group').filter({ has: page.getByRole('heading', { name: 'Card rename fixture', exact: true }) })
  await card.getByTitle('Project actions').click()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Renamed fixture')
  await page.getByRole('textbox', { name: 'Project name', exact: true }).press('Enter')
  const renamed = page.locator('div.group').filter({ has: page.getByRole('heading', { name: 'Renamed fixture', exact: true }) })
  await renamed.getByTitle('Open this project in the editor').click()
  await expect(page.getByTitle('Back to Home')).toBeVisible()
  const state = await page.evaluate(async ({ target, current }) => {
    const { idbGet, STORES } = await import('/src/lib/idb.ts')
    const { useProjectStore } = await import('/src/state/useProjectStore.ts')
    return {
      activeId: useProjectStore.getState().projectId,
      activeName: useProjectStore.getState().name,
      savedName: (await idbGet(STORES.projects, target)).name,
      otherName: (await idbGet(STORES.projects, current)).name,
    }
  }, ids)
  expect(state).toEqual({ activeId: ids.target, activeName: 'Renamed fixture', savedName: 'Renamed fixture', otherName: 'Current fixture' })
})

test('three untouched launches followed by Projects do not create records', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const visits: unknown[] = []
  for (let visit = 0; visit < 3; visit++) {
    await page.goto('/#/build')
    await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 45_000 })
    await page.getByTitle('Back to Home').click()
    await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Projects' }).click()
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await expect(page).toHaveURL(/#\/projects$/)
    const snapshot = await page.evaluate(async () => {
      const { idbGetAll, STORES } = await import('/src/lib/idb.ts')
      const { useProjectStore } = await import('/src/state/useProjectStore.ts')
      const records = await idbGetAll(STORES.projects)
      return {
        stored: records.length,
        listed: useProjectStore.getState().projectList.length,
        content: records.map((r: any) => ({
          id: r.id, name: r.name,
          objects: r.scenes.reduce((n: number, s: any) => n + s.sceneMeta.length, 0),
          anchors: r.scenes.reduce((n: number, s: any) => n + (s.paths ?? []).reduce((sum: number, p: any) => sum + p.anchors.length, 0), 0),
          shots: r.scenes.reduce((n: number, s: any) => n + s.shots.length, 0),
        })),
      }
    })
    visits.push(snapshot)
  }
  await page.screenshot({ path: info.outputPath('projects-empty-records.png') })
  await info.attach('visit-counts', { body: JSON.stringify(visits, null, 2), contentType: 'application/json' })
  expect(visits.map((v: any) => v.stored)).toEqual([0, 0, 0])
})

test('an autosaved model appears immediately in Projects without a saved shot', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/#/build')
  await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 45_000 })
  await page.evaluate(async () => {
    const { useSceneStore } = await import('/src/state/useSceneStore.ts')
    useSceneStore.getState().addPrimitive('box')
  })
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByTitle('Back to Home').click()
  await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(page.getByText('1 object', { exact: false })).toBeVisible()
  const snapshot = await page.evaluate(async () => {
    const { idbGetAll, STORES } = await import('/src/lib/idb.ts')
    const { useProjectStore } = await import('/src/state/useProjectStore.ts')
    const records = await idbGetAll(STORES.projects)
    return {
      stored: records.length,
      objects: records[0]?.scenes[0]?.sceneMeta.length,
      listed: useProjectStore.getState().projectList.length,
      shots: records[0]?.scenes[0]?.shots.length,
    }
  })
  await page.screenshot({ path: info.outputPath('projects-missing-autosave.png') })
  await info.attach('model-save', { body: JSON.stringify(snapshot), contentType: 'application/json' })
  expect(snapshot.objects).toBe(1)
  expect(snapshot.listed).toBe(snapshot.stored)
})
