import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
})

test('refresh restores the project, second scene and Compose mode', async ({ page }) => {
  await page.goto('/#/build')
  await expect(page.getByTitle('Back to Home')).toBeVisible()
  const ids = await page.evaluate(async () => {
    const { createProject, createScene } = await import('/src/lib/projects.ts')
    const project = await createProject('Pages fixture')
    const scene = await createScene('Second place')
    return { project, scene }
  })
  await page.getByTitle('Frame shots and edit the camera').click()
  await expect(page).toHaveURL(new RegExp(`#/p/${ids.project}/${ids.scene}/compose$`))
  await page.reload()
  await expect(page.getByTitle('Back to Home')).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const { useProjectStore } = await import('/src/state/useProjectStore.ts')
    const { useEditorStore } = await import('/src/state/useEditorStore.ts')
    return { project: useProjectStore.getState().projectId, scene: useProjectStore.getState().activeSceneId, mode: useEditorStore.getState().workspaceMode }
  })).toEqual({ ...ids, mode: 'compose' })
  await page.getByTitle('Place objects in the scene').click()
  await expect(page).toHaveURL(/\/build$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/compose$/)
  await expect.poll(() => page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/useEditorStore.ts')
    return useEditorStore.getState().workspaceMode
  })).toBe('compose')
  await page.goForward()
  await expect(page).toHaveURL(/\/build$/)
})

test('Back to the blank launch preserves the saved draft and Forward restores it', async ({ page }) => {
  await page.goto('/#/build')
  await expect(page).toHaveURL(/#\/build$/)
  await page.getByRole('button', { name: 'Box', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#\/p\/.+\/build$/)
  const projectUrl = page.url()
  await page.goBack()
  await expect(page).toHaveURL(/#\/build$/)
  await expect.poll(() => page.evaluate(async () => {
    const { useProjectStore } = await import('/src/state/useProjectStore.ts')
    const { useSceneStore } = await import('/src/state/useSceneStore.ts')
    const { idbGetAll, STORES } = await import('/src/lib/idb.ts')
    return { active: useProjectStore.getState().projectId, objects: useSceneStore.getState().objects.length, records: (await idbGetAll(STORES.projects)).length }
  })).toEqual({ active: '', objects: 0, records: 1 })
  await page.goForward()
  await expect(page).toHaveURL(projectUrl)
  await expect.poll(() => page.evaluate(async () => {
    const { useSceneStore } = await import('/src/state/useSceneStore.ts')
    return useSceneStore.getState().objects.length
  })).toBe(1)
})

test('Projects survives refresh without creating an empty project', async ({ page }) => {
  await page.goto('/#/build')
  await page.getByTitle('Back to Home').click()
  await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Projects' }).click()
  await expect(page).toHaveURL(/#\/projects$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const { idbGetAll, STORES } = await import('/src/lib/idb.ts')
    return (await idbGetAll(STORES.projects)).length
  })).toBe(0)
})
