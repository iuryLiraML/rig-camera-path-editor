import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
})

test('Home preview is non-destructive and Start opens a focused lesson project', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const storedProjectCount = () => page.evaluate(async () => {
    const { idbGetAll, STORES } = await import('/src/lib/idb.ts')
    return (await idbGetAll(STORES.projects)).length
  })

  expect(await storedProjectCount()).toBe(0)
  await page.getByRole('button', { name: /Tutorial Build a room/ }).click()
  const preview = page.getByRole('dialog', { name: 'Make your first camera move' })
  await expect(preview.getByRole('img', { name: /Three grayscale frames/ })).toBeVisible()
  await expect(preview.getByText('Example frames', { exact: false })).toBeVisible()
  expect(await storedProjectCount()).toBe(0)

  await preview.getByRole('button', { name: 'Not now' }).click()
  expect(await storedProjectCount()).toBe(0)
  await page.getByRole('button', { name: /Tutorial Build a room/ }).click()
  await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).click()

  await expect(page.getByRole('heading', { name: 'Start a separate lesson project' })).toBeVisible()
  await expect(page.getByRole('status').getByText('Practice observed')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Add an Object', exact: true })).toHaveCount(0)
  await expect(page.getByText('Director', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()

  const record = await page.evaluate(async () => {
    const { idbGetAll, STORES } = await import('/src/lib/idb.ts')
    const useProjectStore = window.__stores.project
    const rows = await idbGetAll(STORES.projects)
    return {
      count: rows.length,
      record: rows[0] && {
        name: rows[0].name,
        sceneCount: rows[0].scenes.length,
        actionId: rows[0].workflow.tutorial?.currentActionId,
        version: rows[0].workflow.tutorial?.version,
        activeProjectId: useProjectStore.getState().projectId,
      },
    }
  })
  expect(record).toEqual({
    count: 1,
    record: {
      name: 'Tutorial',
      sceneCount: 1,
      actionId: 'intro.start',
      version: 2,
      activeProjectId: expect.any(String),
    },
  })

  await page.screenshot({ path: info.outputPath('tutorial-first-action.png') })
})

test('lesson layout stays on-screen across the named viewport matrix', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: /Tutorial Build a room/ }).click()
  await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).click()

  const lesson = page.getByRole('region', { name: 'Guided lesson' })
  await expect(lesson.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()

  const matrix = [
    { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 },
    { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1024, height: 600 },
    { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ]
  for (const size of matrix) {
    await page.setViewportSize(size)
    await expect.poll(async () => {
      const box = await lesson.boundingBox()
      const viewport = page.viewportSize()
      return box && viewport
        && box.x >= 0 && box.y >= 0
        && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height
    }).toBe(true)
    const lessonBox = await lesson.boundingBox()
    expect(lessonBox).not.toBeNull()
    const viewport = page.viewportSize()!
    expect(lessonBox!.x).toBeGreaterThanOrEqual(0)
    expect(lessonBox!.y).toBeGreaterThanOrEqual(0)
    expect(lessonBox!.x + lessonBox!.width).toBeLessThanOrEqual(viewport.width)
    expect(lessonBox!.y + lessonBox!.height).toBeLessThanOrEqual(viewport.height)
    await expect(lesson.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
    const continueBox = await lesson.getByRole('button', { name: 'Continue', exact: true }).boundingBox()
    expect(continueBox?.height).toBeGreaterThanOrEqual(44)

    if (size.width < 600 || (size.height < 500 && size.width < 1024)) {
      const modeBox = await page.getByRole('button', { name: 'Build', exact: true }).boundingBox()
      const taskBarBox = await page.getByRole('button', { name: 'Scene', exact: true }).boundingBox()
      expect(modeBox).not.toBeNull()
      expect(taskBarBox).not.toBeNull()
      expect(lessonBox!.y).toBeGreaterThanOrEqual(modeBox!.y + modeBox!.height)
      expect(lessonBox!.y + lessonBox!.height).toBeLessThanOrEqual(taskBarBox!.y)
    }
  }
})

test('pause and reload preserve the same lesson project and current action', async ({ page }) => {
  await page.getByRole('button', { name: /Tutorial Build a room/ }).click()
  await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).click()
  const lesson = page.getByRole('region', { name: 'Guided lesson' })
  const original = await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    const state = useProjectStore.getState()
    return { projectId: state.projectId, actionId: state.workflow.tutorial?.currentActionId }
  })

  await lesson.getByRole('button', { name: 'Pause lesson' }).click()
  await expect(page.getByRole('status').getByText(/Tutorial paused/)).toBeVisible()
  await expect.poll(async () => page.evaluate(async () => {
    const { idbGetAll, STORES } = await import('/src/lib/idb.ts')
    const rows = await idbGetAll(STORES.projects)
    return rows[0]?.workflow.tutorial?.active
  })).toBe(false)
  await page.reload()
  const paused = page.getByRole('status')
  await expect(paused.getByText(/Tutorial paused/)).toBeVisible()
  await paused.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByRole('region', { name: 'Guided lesson' })).toBeVisible()

  const resumed = await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    const state = useProjectStore.getState()
    return { projectId: state.projectId, actionId: state.workflow.tutorial?.currentActionId }
  })
  expect(resumed).toEqual(original)
})

test('skipping a prerequisite does not silently complete its dependent action', async ({ page }) => {
  await page.getByRole('button', { name: /Tutorial Build a room/ }).click()
  await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).click()
  let lesson = page.getByRole('region', { name: 'Guided lesson' })
  await lesson.getByRole('button', { name: 'Continue', exact: true }).click()
  lesson = page.getByRole('region', { name: 'Guided lesson' })
  await expect(lesson.getByRole('heading', { name: 'Move the working view' })).toBeVisible()
  // Continue now skips-and-advances an un-practiced action in one click.
  await lesson.getByRole('button', { name: 'Continue', exact: true }).click()

  lesson = page.getByRole('region', { name: 'Guided lesson' })
  await expect(lesson.getByRole('heading', { name: 'Select, frame and undo' })).toBeVisible()
  // The dependent action is not silently completed: it surfaces the skipped
  // prerequisite. Continue stays available so the learner is never trapped.
  await expect(lesson.getByText('An earlier action was skipped. Go back to it, or press Continue to move on.')).toBeVisible()
  await expect(lesson.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
})

test('switching to another scene blocks lesson progress until its scene returns', async ({ page }) => {
  await page.getByRole('button', { name: /Tutorial Build a room/ }).click()
  await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).click()
  const lesson = page.getByRole('region', { name: 'Guided lesson' })
  const sceneId = await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    return useProjectStore.getState().activeSceneId
  })
  await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    useProjectStore.setState({ activeSceneId: 'unrelated-scene' })
  })
  await expect(lesson.getByText('This lesson is attached to another scene. Return to its scene before continuing.')).toBeVisible()
  await expect(lesson.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
  await page.evaluate(async (activeSceneId) => {
    const useProjectStore = window.__stores.project
    useProjectStore.setState({ activeSceneId })
  }, sceneId)
  await expect(lesson.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
})

test('switching projects and returning restores the tutorial and its current action', async ({ page }) => {
  await page.getByRole('button', { name: /Tutorial Build a room/ }).click()
  await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).click()
  const lesson = page.getByRole('region', { name: 'Guided lesson' })
  const original = await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    const state = useProjectStore.getState()
    return { projectId: state.projectId, actionId: state.workflow.tutorial?.currentActionId }
  })

  const otherProjectId = await page.evaluate(async () => {
    const { createProject } = await import('/src/lib/projects.ts')
    return createProject('Temporary tutorial-switch check')
  })
  await expect(lesson).toHaveCount(0)
  await page.evaluate(async (projectId) => {
    const { switchProject } = await import('/src/lib/projects.ts')
    await switchProject(projectId)
  }, original.projectId)
  await expect(page.getByRole('region', { name: 'Guided lesson' })).toBeVisible()

  const restored = await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    const state = useProjectStore.getState()
    return { projectId: state.projectId, actionId: state.workflow.tutorial?.currentActionId }
  })
  expect(restored).toEqual(original)
  await page.evaluate(async (projectId) => {
    const { deleteProject } = await import('/src/lib/projects.ts')
    await deleteProject(projectId)
  }, otherProjectId)
})

test.describe('phone touch input', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

  test('keyboard and touch can operate the lesson on a phone-sized screen', async ({ page }) => {
    await page.getByRole('button', { name: /Tutorial Build a room/ }).tap()
    await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).tap()

    let lesson = page.getByRole('region', { name: 'Guided lesson' })
    const continueButton = lesson.getByRole('button', { name: 'Continue', exact: true })
    await continueButton.focus()
    await expect(continueButton).toBeFocused()
    await page.keyboard.press('Enter')
    lesson = page.getByRole('region', { name: 'Guided lesson' })
    await lesson.getByRole('button', { name: 'Expand lesson instructions' }).tap()
    await expect(lesson.getByRole('heading', { name: 'Move the working view' })).toBeVisible()
    await lesson.getByRole('button', { name: 'I practiced these controls' }).tap()
    await lesson.getByRole('button', { name: 'Continue', exact: true }).tap()
    await page.getByRole('button', { name: 'Scene', exact: true }).last().tap()
    const nextLesson = page.getByRole('region', { name: 'Guided lesson' })
    await nextLesson.getByRole('button', { name: 'Expand lesson instructions' }).tap()
    await expect(nextLesson.getByRole('heading', { name: 'Select, frame and undo' })).toBeVisible()
  })
})
