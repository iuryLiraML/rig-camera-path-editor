import { expect, test, type Page } from '@playwright/test'

const ACTION_IDS = [
  'intro.result', 'intro.start', 'navigate.view', 'navigate.recover',
  'room.create', 'room.edit', 'room.door', 'room.insert',
  'room.scene-edit',
  'figure.add', 'figure.place', 'figure.pose',
  'camera.select', 'camera.path', 'camera.height', 'camera.frame',
  'timing.duration', 'timing.lens',
  'finish.review', 'finish.export', 'finish.return',
]

async function currentTutorial(page: Page) {
  return page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    return useProjectStore.getState().workflow.tutorial
  })
}

async function waitForAction(page: Page, actionId: string) {
  await expect.poll(async () => (await currentTutorial(page))?.currentActionId).toBe(actionId)
}

async function waitForStatus(page: Page, actionId: string, status: string) {
  await expect.poll(async () => {
    const tutorial = await currentTutorial(page)
    if (!tutorial || !('actions' in tutorial)) return undefined
    return tutorial.actions[actionId]?.status
  }).toBe(status)
}

async function continueAction(page: Page, actionId: string, nextActionId: string) {
  await waitForAction(page, actionId)
  await closeOpenPhoneTask(page)
  await page.getByRole('region', { name: 'Guided lesson' }).getByRole('button', { name: 'Continue', exact: true }).click()
  await waitForAction(page, nextActionId)
}

async function openControl(page: Page) {
  const button = page.getByRole('region', { name: 'Guided lesson' }).getByRole('button', { name: 'Open control' })
  if (await button.isVisible().catch(() => false)) await button.click()
}

async function openPhoneTask(page: Page, label: string) {
  const button = page.getByRole('button', { name: label, exact: true }).last()
  if (await button.getAttribute('aria-pressed') !== 'true') await button.tap()
}

async function closePhoneTask(page: Page, label: string) {
  const button = page.getByRole('button', { name: label, exact: true }).last()
  if (await button.getAttribute('aria-pressed') === 'true') await button.tap()
}

async function closeOpenPhoneTask(page: Page) {
  const labels = new Set(['Scene', 'Add', 'Timeline', 'Animate', 'Director', 'Visualize'])
  for (const button of await page.locator('button[aria-pressed="true"]').all()) {
    if (labels.has((await button.textContent())?.trim() ?? '') && await button.isVisible()) {
      await button.tap()
      return
    }
  }
}

async function collapseLesson(page: Page) {
  const button = page.getByRole('region', { name: 'Guided lesson' }).getByRole('button', { name: 'Collapse lesson instructions' })
  if (await button.isVisible().catch(() => false)) await button.tap()
}

async function expandLesson(page: Page) {
  const button = page.getByRole('region', { name: 'Guided lesson' }).getByRole('button', { name: 'Expand lesson instructions' })
  if (await button.isVisible().catch(() => false)) await button.tap()
}

async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ id: 1, x: from.x, y: from.y }],
  })
  for (let step = 1; step <= 5; step++) {
    const t = step / 5
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{
        id: 1,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      }],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

async function touchMultiGesture(
  page: Page,
  from: Array<{ x: number; y: number }>,
  to: Array<{ x: number; y: number }>,
) {
  if (from.length !== to.length || from.length < 2) throw new Error('A multi-touch gesture needs matching point pairs')
  const cdp = await page.context().newCDPSession(page)
  const points = (positions: Array<{ x: number; y: number }>) =>
    positions.map((point, index) => ({ id: index + 1, ...point }))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) })
  for (let step = 1; step <= 5; step++) {
    const t = step / 5
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(from.map((start, index) => ({
        x: start.x + (to[index]!.x - start.x) * t,
        y: start.y + (to[index]!.y - start.y) * t,
      }))),
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

async function touchRangeValue(page: Page, range: ReturnType<Page['locator']>, target: number) {
  const bounds = await range.boundingBox()
  expect(bounds).not.toBeNull()
  const tapAt = async (fraction: number) => {
    await page.touchscreen.tap(bounds!.x + bounds!.width * fraction, bounds!.y + bounds!.height / 2)
    return Number(await range.inputValue())
  }
  const lowPosition = 0.15
  const highPosition = 0.85
  const lowValue = await tapAt(lowPosition)
  const highValue = await tapAt(highPosition)
  expect(highValue).toBeGreaterThan(lowValue)
  const valuePerPosition = (highValue - lowValue) / (highPosition - lowPosition)
  let targetPosition = lowPosition + (target - lowValue) / valuePerPosition
  expect(targetPosition).toBeGreaterThanOrEqual(0)
  expect(targetPosition).toBeLessThanOrEqual(1)
  let actual = await tapAt(targetPosition)
  for (let attempt = 0; actual !== target && attempt < 4; attempt++) {
    targetPosition += (target - actual) / valuePerPosition
    expect(targetPosition).toBeGreaterThanOrEqual(0)
    expect(targetPosition).toBeLessThanOrEqual(1)
    actual = await tapAt(targetPosition)
  }
  expect(actual).toBe(target)
}

test('complete the 21-action first camera move lesson through its real workspaces', async ({ page }, info) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()

  await page.getByRole('button', { name: /Tutorial Build a room/ }).click()
  const preview = page.getByRole('dialog', { name: 'Make your first camera move' })
  await preview.getByRole('button', { name: 'Start lesson' }).click()
  const lesson = page.getByRole('region', { name: 'Guided lesson' })

  // Start the isolated project seeded by the preview; the preview itself already
  // records intro.result, and starting binds this run to its new scene.
  await waitForAction(page, 'intro.start')
  await waitForStatus(page, 'intro.start', 'practiced')
  const projectId = await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    return useProjectStore.getState().projectId
  })
  await continueAction(page, 'intro.start', 'navigate.view')

  // Practice orbit, pan and zoom on the editor canvas, then explicitly confirm.
  await openControl(page)
  const viewport = page.locator('canvas').first()
  await expect(viewport).toBeVisible()
  const viewportBox = await viewport.boundingBox()
  expect(viewportBox).not.toBeNull()
  const cx = viewportBox!.x + viewportBox!.width * 0.55
  const cy = viewportBox!.y + viewportBox!.height * 0.48
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(cx + 24, cy + 12, { steps: 3 })
  await page.mouse.up({ button: 'middle' })
  await page.keyboard.down('Shift')
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(cx - 18, cy + 9, { steps: 3 })
  await page.mouse.up({ button: 'middle' })
  await page.keyboard.up('Shift')
  await page.mouse.move(cx, cy)
  await page.mouse.wheel(0, -100)
  await lesson.getByRole('button', { name: 'I practiced these controls' }).click()
  await waitForStatus(page, 'navigate.view', 'confirmed')
  await continueAction(page, 'navigate.view', 'navigate.recover')

  // Select, frame, move, undo, and delete only the named throwaway cube.
  await openControl(page)
  const cubeRow = page.locator('[data-tour="practice-cube-row"]')
  await expect(cubeRow).toBeVisible()
  await cubeRow.locator('button').first().click()
  await page.keyboard.press('f')
  await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    const useSceneStore = window.__stores.scene
    const id = (useProjectStore.getState().workflow.tutorial as { artifacts: { practiceCubeId: string } }).artifacts.practiceCubeId
    useSceneStore.getState().setTransform(id, 'position', 0, 0.5)
  })
  await page.keyboard.press('Control+z')
  await cubeRow.getByRole('button', { name: 'Delete object' }).click()
  await cubeRow.getByRole('button', { name: 'Delete?' }).click()
  await waitForStatus(page, 'navigate.recover', 'practiced')
  await continueAction(page, 'navigate.recover', 'room.create')

  // Create and edit the starter Plan, then use the real Library insert control.
  await openControl(page)
  await page.getByRole('button', { name: 'New floor plan', exact: true }).first().click()
  await expect(page.getByRole('region', { name: '2D floor plan editor' })).toBeVisible()
  await waitForStatus(page, 'room.create', 'practiced')
  await continueAction(page, 'room.create', 'room.edit')

  await page.evaluate(async () => {
    const { planActions, planVertices } = await import('/src/lib/floorPlanModel.ts')
    const store = window.__planEditorStore.getState()
    const vertex = planVertices(store.plan.walls).sort((a, b) => (b.x + b.y) - (a.x + a.y))[0]!
    planActions.beginEdit(store.plan)
    planActions.moveVertex(store.plan, vertex.key, { x: vertex.x + 2, y: vertex.y + 1 })
    store.publish()
  })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status').getByText('Saved to Library')).toBeVisible()
  await waitForStatus(page, 'room.edit', 'practiced')
  await continueAction(page, 'room.edit', 'room.door')

  await page.getByRole('button', { name: 'Door', exact: true }).click()
  await page.evaluate(async () => {
    const { planActions, wallLength } = await import('/src/lib/floorPlanModel.ts')
    const store = window.__planEditorStore.getState()
    const wall = store.plan.walls[0]!
    planActions.placeOpening(store.plan, wall.id, wallLength(wall) / 2, 'door')
    store.publish()
  })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status').getByText('Saved to Library')).toBeVisible()
  await waitForStatus(page, 'room.door', 'practiced')
  await continueAction(page, 'room.door', 'room.insert')

  const insertPlan = page.getByRole('button', { name: 'Insert into scene', exact: true })
  await expect(insertPlan).toBeVisible()
  await insertPlan.click()
  await waitForStatus(page, 'room.insert', 'practiced')
  await continueAction(page, 'room.insert', 'room.scene-edit')

  // The scene copy is changed through its actual Build inspector. The Library
  // source remains outside this action and the lesson observes the local graph.
  await openControl(page)
  await page.getByRole('button', { name: 'Edit Plan' }).click()
  await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    const useSceneStore = window.__stores.scene
    const useEditorStore = window.__stores.editor
    const { planFromJSON } = await import('/src/lib/floorPlanModel.ts')
    const tutorial = useProjectStore.getState().workflow.tutorial as { artifacts: { planObjectId: string } }
    const object = useSceneStore.getState().objects.find((item) => item.id === tutorial.artifacts.planObjectId)!
    const wallId = planFromJSON(object.plan!).walls[0]!.id
    useEditorStore.getState().setScenePlanTarget({ kind: 'wall', wallId })
  })
  const scenePlanHeight = page.getByRole('slider', { name: 'Wall height' })
  await expect(scenePlanHeight).toBeVisible()
  await scenePlanHeight.focus()
  await scenePlanHeight.press('ArrowRight')
  await waitForStatus(page, 'room.scene-edit', 'practiced')
  await continueAction(page, 'room.scene-edit', 'figure.add')

  // Add the bundled Figure in Build, reposition it, and change one actual joint.
  await openControl(page)
  await page.locator('[data-primitive="female"]').click()
  await waitForStatus(page, 'figure.add', 'practiced')
  await continueAction(page, 'figure.add', 'figure.place')
  await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    const useSceneStore = window.__stores.scene
    const id = (useProjectStore.getState().workflow.tutorial as { artifacts: { figureId: string } }).artifacts.figureId
    useSceneStore.getState().setTransform(id, 'position', 0, 2)
    useSceneStore.getState().setTransform(id, 'position', 2, 2)
  })
  await waitForStatus(page, 'figure.place', 'practiced')
  await continueAction(page, 'figure.place', 'figure.pose')
  await openControl(page)
  const armRaise = page.locator('[data-tour="figure-pose"]').getByRole('slider', { name: 'Left arm Raise' })
  await expect(armRaise).toBeVisible({ timeout: 20_000 })
  await armRaise.focus()
  await armRaise.press('ArrowRight')
  await waitForStatus(page, 'figure.pose', 'practiced')
  await continueAction(page, 'figure.pose', 'camera.select')

  // Use the Compose outliner to rename the seeded camera option.
  await openControl(page)
  const cameraRow = page.locator('[data-tour="tutorial-camera-option"]')
  await expect(cameraRow).toBeVisible()
  await cameraRow.locator('button').first().click()
  await cameraRow.getByRole('button', { name: 'Rename camera' }).click()
  const cameraName = cameraRow.locator('input')
  await cameraName.fill('Room entrance')
  await cameraName.press('Enter')
  await waitForStatus(page, 'camera.select', 'practiced')
  await continueAction(page, 'camera.select', 'camera.path')

  // Place a two-point open route through the path editor, then finish through
  // the same Pen exit function used by Enter/Finish in the live canvas.
  await openControl(page)
  await page.locator('[data-tour="pen-tool"]').click()
  await page.evaluate(async () => {
    const { CAMERA_PATH_ID } = await import('/src/state/usePathStore.ts')
    const usePathStore = window.__stores.path
    const useRigStore = window.__stores.rig
    usePathStore.getState().setPath([[0, 0.1, -3], [0, 0.1, 2]], false)
    useRigStore.getState().setCameraPath(CAMERA_PATH_ID)
    useRigStore.getState().setCameraKind('path')
    useRigStore.getState().setPathSpace('world')
    const { finishPen } = await import('/src/viewport/path/PenTool.tsx')
    finishPen(false)
  })
  await waitForStatus(page, 'camera.path', 'practiced')
  await continueAction(page, 'camera.path', 'camera.height')

  await openControl(page)
  await page.evaluate(async () => {
    const usePathStore = window.__stores.path
    usePathStore.getState().setPathHeight(1.5)
  })
  await waitForStatus(page, 'camera.height', 'practiced')
  await continueAction(page, 'camera.height', 'camera.frame')

  await openControl(page)
  await lesson.getByRole('button', { name: 'I checked the shot' }).click()
  await waitForStatus(page, 'camera.frame', 'confirmed')
  await continueAction(page, 'camera.frame', 'timing.duration')

  // Set duration in the timeline and move the playhead before creating two
  // camera FOV keys at the ends of the same normalized six-second shot.
  await page.getByRole('spinbutton', { name: 'Shot duration in seconds' }).fill('6')
  await page.evaluate(async () => {
    const useRigStore = window.__stores.rig
    useRigStore.getState().setT(0.5)
  })
  await waitForStatus(page, 'timing.duration', 'practiced')
  await continueAction(page, 'timing.duration', 'timing.lens')
  await page.evaluate(async () => {
    const useRigStore = window.__stores.rig
    const rig = useRigStore.getState()
    rig.setT(0)
    rig.setFov(45)
    rig.upsertChannelKey('fov', 0, 45)
    rig.setT(1)
    rig.setFov(40)
    rig.upsertChannelKey('fov', 1, 40)
  })
  await waitForStatus(page, 'timing.lens', 'practiced')
  await continueAction(page, 'timing.lens', 'finish.review')

  // Review in Visualize, choose the requested Clay/MP4/16:9/720p settings,
  // and accurately report that this browser run skipped the expensive export.
  await openControl(page)
  const play = page.getByRole('button', { name: 'Play / Pause (Space)' })
  await expect(play).toBeEnabled()
  await play.click()
  await page.waitForTimeout(300)
  await play.click()
  await lesson.getByRole('button', { name: 'I reviewed this' }).click()
  await waitForStatus(page, 'finish.review', 'confirmed')
  await continueAction(page, 'finish.review', 'finish.export')

  await openControl(page)
  await page.locator('[data-tour="visualize-export-settings"]').getByRole('button', { name: 'Clay', exact: true }).click()
  await page.locator('[data-tour="visualize-export-settings"]').getByRole('button', { name: '16:9', exact: true }).click()
  await page.locator('[data-tour="visualize-export-settings"]').getByRole('button', { name: '720p', exact: true }).click()
  // No file was rendered; pressing Continue skips the optional export and advances.
  await continueAction(page, 'finish.export', 'finish.return')
  await waitForStatus(page, 'finish.export', 'skipped')
  await expect.poll(async () => (await currentTutorial(page) as { export: { state: string } }).export.state).toBe('skipped')

  await openControl(page)
  await waitForStatus(page, 'finish.return', 'practiced')
  await expect(page.locator(`[data-project-id="${projectId}"]`)).toBeVisible()
  await lesson.getByRole('button', { name: 'Finish lesson' }).click()
    const summary = page.getByRole('region', { name: 'Tutorial summary' })
    await expect(summary.getByText(/Export: skipped/)).toBeVisible()
    const reopenButton = summary.getByRole('button', { name: 'Reopen Tutorial' })
    const reopenBounds = await reopenButton.boundingBox()
    expect(reopenBounds).not.toBeNull()
    const finished = await currentTutorial(page) as { actions: Record<string, { status: string }>; done: boolean; currentActionId: string }
  expect(finished.done).toBe(true)
  expect(finished.currentActionId).toBe('finish.return')
  expect(Object.keys(finished.actions).sort()).toEqual([...ACTION_IDS].sort())
  expect(finished.actions['finish.export']?.status).toBe('skipped')

    await reopenButton.click()
  await expect(page.getByRole('region', { name: 'Tutorial summary' })).toBeVisible()
  await expect.poll(async () => page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    return useProjectStore.getState().projectId
  })).toBe(projectId)
  await page.screenshot({ path: info.outputPath('tutorial-complete-summary.png') })
})

test('phone opens the task-specific pose inspector for the pose lesson', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await page.getByRole('button', { name: /Tutorial Build a room/ }).click()
  await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).click()
  await waitForAction(page, 'intro.start')

  await page.evaluate(async () => {
    const useProjectStore = window.__stores.project
    const store = useProjectStore.getState()
    const progress = store.workflow.tutorial
    if (!progress || progress.version !== 2 || !('currentActionId' in progress)) throw new Error('Tutorial v2 was not started')
    store.setWorkflow({ ...store.workflow, tutorial: { ...progress, currentActionId: 'figure.pose' } })
  })

  const inspector = page.getByRole('region', { name: 'Figure pose inspector' })
  await expect(inspector).toBeVisible()
  await expect(inspector.getByText('Select the lesson Figure to edit its pose.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Director', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test.describe('phone lesson authoring surfaces', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

  test('opens the Figure tools sheet and exposes its real Figure choices', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Skip', exact: true }).tap()
    await page.getByRole('button', { name: /Tutorial Build a room/ }).tap()
    await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).tap()
    await waitForAction(page, 'intro.start')

    await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const store = useProjectStore.getState()
      const progress = store.workflow.tutorial
      if (!progress || progress.version !== 2 || !('currentActionId' in progress)) throw new Error('Tutorial v2 was not started')
      store.setWorkflow({
        ...store.workflow,
        tutorial: {
          ...progress,
          currentActionId: 'figure.add',
          actions: {
            ...progress.actions,
            'room.insert': {
              status: 'practiced',
              evidence: { kind: 'phone-surface-test-prerequisite', sceneId: progress.sceneId },
            },
            'room.scene-edit': {
              status: 'practiced',
              evidence: { kind: 'phone-surface-test-prerequisite', sceneId: progress.sceneId },
            },
          },
        },
      })
    })

    await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { name: 'Add an Object' })).toBeVisible()
    await page.locator('[data-tour="figures-drawer"]').tap()
    await expect(page.locator('[data-primitive="female"]')).toBeVisible()
    await expect(page.locator('[data-primitive="male"]')).toBeVisible()
    await page.locator('[data-primitive="female"]').tap()
    await waitForStatus(page, 'figure.add', 'practiced')
  })

  test('moves and poses the lesson Figure through touch interactions', async ({ page, browserName }) => {
    test.setTimeout(60_000)
    test.skip(browserName !== 'chromium', 'The scene drag uses Chromium touch input dispatch')
    await page.goto('/')
    await page.getByRole('button', { name: 'Skip', exact: true }).tap()
    await page.getByRole('button', { name: /Tutorial Build a room/ }).tap()
    await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).tap()
    await waitForAction(page, 'intro.start')
    await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const project = useProjectStore.getState()
      const progress = project.workflow.tutorial
      if (!progress || progress.version !== 2 || !('currentActionId' in progress)) throw new Error('Tutorial v2 was not started')
      project.setWorkflow({
        ...project.workflow,
        tutorial: {
          ...progress,
          currentActionId: 'figure.add',
          actions: {
            ...progress.actions,
            'room.insert': {
              status: 'practiced',
              evidence: { kind: 'phone-figure-test-prerequisite', sceneId: progress.sceneId },
            },
            'room.scene-edit': {
              status: 'practiced',
              evidence: { kind: 'phone-figure-test-prerequisite', sceneId: progress.sceneId },
            },
          },
        },
      })
    })

    await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.locator('[data-tour="figures-drawer"]').tap()
    await page.locator('[data-primitive="female"]').tap()
    await waitForStatus(page, 'figure.add', 'practiced')
    await continueAction(page, 'figure.add', 'figure.place')
    await collapseLesson(page)
    await closePhoneTask(page, 'Add')

    const start = await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const useSceneStore = window.__stores.scene
      const editorCameraRef = window.__editorCameraRef
      const objectGroups = window.__objectGroups
      const progress = useProjectStore.getState().workflow.tutorial as { artifacts: { figureId: string } }
      const id = progress.artifacts.figureId
      const object = useSceneStore.getState().objects.find((item) => item.id === id)!
      const group = objectGroups.get(id)!
      const camera = editorCameraRef.current!
      group.updateWorldMatrix(true, true)
      camera.updateMatrixWorld(true)
      const body = group.position.clone()
      body.y += 1.6
      body.project(camera)
      const canvas = document.querySelector<HTMLCanvasElement>('canvas')!
      const rect = canvas.getBoundingClientRect()
      return {
        id,
        position: object.transform.position,
        x: rect.left + (body.x + 1) * rect.width / 2,
        y: rect.top + (1 - body.y) * rect.height / 2,
      }
    })
    await touchDrag(page, { x: start.x, y: start.y }, { x: start.x + 28, y: start.y - 10 })
    const moved = await page.evaluate(async (id) => {
      const useSceneStore = window.__stores.scene
      return useSceneStore.getState().objects.find((item) => item.id === id)?.transform.position
    }, start.id)
    expect(moved).not.toEqual(start.position)
    await waitForStatus(page, 'figure.place', 'practiced')

    await continueAction(page, 'figure.place', 'figure.pose')
    await collapseLesson(page)
    const raise = page.locator('[data-tour="figure-pose"]').getByRole('slider', { name: 'Left arm Raise' })
    await expect(raise).toBeVisible()
    const before = await raise.inputValue()
    const sliderBox = await raise.boundingBox()
    expect(sliderBox).not.toBeNull()
    await page.touchscreen.tap(sliderBox!.x + sliderBox!.width * 0.85, sliderBox!.y + sliderBox!.height / 2)
    await expect.poll(() => raise.inputValue()).not.toBe(before)
    await waitForStatus(page, 'figure.pose', 'practiced')
  })

  test('enters camera preview and returns to the active Compose task by touch', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Skip', exact: true }).tap()
    await page.getByRole('button', { name: /Tutorial Build a room/ }).tap()
    await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).tap()
    await waitForAction(page, 'intro.start')
    await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const useEditorStore = window.__stores.editor
      const { CAMERA_PATH_ID } = await import('/src/state/usePathStore.ts')
      const usePathStore = window.__stores.path
      const useRigStore = window.__stores.rig
      const project = useProjectStore.getState()
      const progress = project.workflow.tutorial
      if (!progress || progress.version !== 2 || !('currentActionId' in progress)) throw new Error('Tutorial v2 was not started')
      project.setWorkflow({
        ...project.workflow,
        tutorial: {
          ...progress,
          currentActionId: 'camera.frame',
          actions: {
            ...progress.actions,
            'camera.height': {
              status: 'practiced',
              evidence: { kind: 'phone-preview-test-prerequisite', sceneId: progress.sceneId },
            },
          },
        },
      })
      useEditorStore.getState().setWorkspaceMode('compose')
      usePathStore.getState().setPath([[0, 1.4, -6], [0, 1.4, 6]], false)
      useRigStore.getState().setCameraPath(CAMERA_PATH_ID)
      useRigStore.getState().setCameraKind('path')
      useRigStore.getState().setPathSpace('world')
      useRigStore.getState().setLookAtMode('target')
      useRigStore.getState().setTarget([0, 1, 0])
      useRigStore.getState().setT(0)
    })

    await expect(page.getByRole('button', { name: 'Director', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await closeOpenPhoneTask(page)
    await expandLesson(page)
    await expect(page.getByRole('region', { name: 'Guided lesson' }).getByText(/tap Look through in the Compose task sheet header/i)).toBeVisible()
    await collapseLesson(page)
    await openPhoneTask(page, 'Director')
    await page.getByRole('button', { name: 'Look through', exact: true }).tap()
    const returnButton = page.getByRole('button', { name: 'Return to editor' })
    await expect(returnButton).toBeVisible()
    const returnBounds = await returnButton.boundingBox()
    expect(returnBounds).not.toBeNull()
    expect(returnBounds!.x).toBeGreaterThanOrEqual(0)
    expect(returnBounds!.y + returnBounds!.height).toBeLessThanOrEqual(844)
    await expect.poll(async () => page.evaluate(async () => {
      const useEditorStore = window.__stores.editor
      return useEditorStore.getState().cameraView
    })).toBe(true)

    await page.getByRole('button', { name: 'Return to editor' }).tap()
    await expect.poll(async () => page.evaluate(async () => {
      const useEditorStore = window.__stores.editor
      return useEditorStore.getState().cameraView
    })).toBe(false)
    await expect(page.getByRole('button', { name: 'Director', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Look through', exact: true })).toBeVisible()
  })

  test('edits the Library Plan, adds a door and inserts it using touch', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'This end-to-end drag uses Chromium touch input dispatch')
    await page.goto('/')
    await page.getByRole('button', { name: 'Skip', exact: true }).tap()
    await page.getByRole('button', { name: /Tutorial Build a room/ }).tap()
    await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).tap()
    await waitForAction(page, 'intro.start')
    await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const project = useProjectStore.getState()
      const progress = project.workflow.tutorial
      if (!progress || progress.version !== 2 || !('currentActionId' in progress)) throw new Error('Tutorial v2 was not started')
      project.setWorkflow({
        ...project.workflow,
        tutorial: {
          ...progress,
          currentActionId: 'room.create',
          actions: {
            ...progress.actions,
            'navigate.recover': {
              status: 'practiced',
              evidence: { kind: 'phone-plan-test-prerequisite', sceneId: progress.sceneId },
            },
          },
        },
      })
    })

    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
    await expect(page.locator('[data-tour="library-new-plan"]')).toBeVisible()
    await page.locator('[data-tour="library-new-plan"]').tap()
    await expect(page.getByRole('region', { name: '2D floor plan editor' })).toBeVisible()
    await waitForStatus(page, 'room.create', 'practiced')
    await continueAction(page, 'room.create', 'room.edit')
    await collapseLesson(page)

    const corner = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="2D floor plan"]')!
      const plan = window.__planEditorStore.getState().plan
      const xs = plan.walls.flatMap((wall) => [wall.a.x, wall.b.x])
      const ys = plan.walls.flatMap((wall) => [wall.a.y, wall.b.y])
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
      const scale = Math.max(14, Math.min(160,
        (canvas.clientWidth - 180) / Math.max(0.5, maxX - minX),
        (canvas.clientHeight - 180) / Math.max(0.5, maxY - minY)))
      const offsetX = canvas.clientWidth / 2 - ((minX + maxX) / 2) * scale
      const offsetY = canvas.clientHeight / 2 - ((minY + maxY) / 2) * scale
      const rect = canvas.getBoundingClientRect()
      return {
        x: rect.left + offsetX + maxX * scale,
        y: rect.top + offsetY + maxY * scale,
        scale,
        before: JSON.stringify(plan.walls),
      }
    })
    expect(corner.scale).toBeGreaterThan(0)
    await touchDrag(page, { x: corner.x + 10, y: corner.y + 10 }, { x: corner.x + 18, y: corner.y + 18 })
    const edited = await page.evaluate(async () => {
      const { planRooms } = await import('/src/lib/floorPlanModel.ts')
      const plan = window.__planEditorStore.getState().plan
      const points = plan.walls.flatMap((wall) => [wall.a, wall.b])
      return {
        walls: JSON.stringify(plan.walls),
        rooms: planRooms(plan.walls).length,
        farCorner: { x: Math.max(...points.map((point) => point.x)), y: Math.max(...points.map((point) => point.y)) },
      }
    })
    expect(edited.walls).not.toBe(corner.before)
    expect(edited.rooms).toBe(1)
    expect(edited.farCorner.x).toBeCloseTo(4.5, 0)
    expect(edited.farCorner.y).toBeCloseTo(4.5, 0)
    await page.getByRole('button', { name: 'Save', exact: true }).tap()
    await waitForStatus(page, 'room.edit', 'practiced')
    await continueAction(page, 'room.edit', 'room.door')

    await page.locator('[data-tour="plan-door"]').tap()
    await collapseLesson(page)
    const wallMidpoint = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="2D floor plan"]')!
      const plan = window.__planEditorStore.getState().plan
      const xs = plan.walls.flatMap((wall) => [wall.a.x, wall.b.x])
      const ys = plan.walls.flatMap((wall) => [wall.a.y, wall.b.y])
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
      const scale = Math.max(14, Math.min(160,
        (canvas.clientWidth - 180) / Math.max(0.5, maxX - minX),
        (canvas.clientHeight - 180) / Math.max(0.5, maxY - minY)))
      const offsetX = canvas.clientWidth / 2 - ((minX + maxX) / 2) * scale
      const offsetY = canvas.clientHeight / 2 - ((minY + maxY) / 2) * scale
      const wall = plan.walls[0]!
      const rect = canvas.getBoundingClientRect()
      return {
        x: rect.left + offsetX + ((wall.a.x + wall.b.x) / 2) * scale,
        y: rect.top + offsetY + ((wall.a.y + wall.b.y) / 2) * scale,
      }
    })
    await page.touchscreen.tap(wallMidpoint.x, wallMidpoint.y)
    await expect.poll(async () => page.evaluate(() => {
      return window.__planEditorStore.getState().plan.openings.length
    })).toBe(1)
    await page.getByRole('button', { name: 'Save', exact: true }).tap()
    await waitForStatus(page, 'room.door', 'practiced')
    await continueAction(page, 'room.door', 'room.insert')

    const insertPlan = page.locator('[data-tour="library-insert-plan"]')
    await expect(insertPlan).toBeVisible()
    await insertPlan.tap()
    await waitForStatus(page, 'room.insert', 'practiced')
  })

  test('opens the phone timeline for the duration lesson', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Skip', exact: true }).tap()
    await page.getByRole('button', { name: /Tutorial Build a room/ }).tap()
    await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).tap()
    await waitForAction(page, 'intro.start')
    await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const useEditorStore = window.__stores.editor
      const { CAMERA_PATH_ID } = await import('/src/state/usePathStore.ts')
      const usePathStore = window.__stores.path
      const useRigStore = window.__stores.rig
      const project = useProjectStore.getState()
      const progress = project.workflow.tutorial
      if (!progress || progress.version !== 2 || !('currentActionId' in progress)) throw new Error('Tutorial v2 was not started')
      project.setWorkflow({
        ...project.workflow,
        tutorial: {
          ...progress,
          currentActionId: 'timing.duration',
          actions: {
            ...progress.actions,
            'camera.frame': {
              status: 'confirmed',
              evidence: { kind: 'phone-surface-test-prerequisite', sceneId: progress.sceneId },
            },
          },
        },
      })
      useEditorStore.getState().setWorkspaceMode('compose')
      usePathStore.getState().setPath([[0, 0.1, -2], [0, 0.1, 2]], false)
      useRigStore.getState().setCameraPath(CAMERA_PATH_ID)
      useRigStore.getState().setCameraKind('path')
      useRigStore.getState().setPathSpace('world')
    })

    await expect(page.getByRole('button', { name: 'Timeline', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('shot-duration')).toBeVisible()
    await expect(page.getByRole('spinbutton', { name: 'Shot duration in seconds' })).toBeVisible()
  })

  test('opens the actual Visualize controls for phone review and export', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Skip', exact: true }).tap()
    await page.getByRole('button', { name: /Tutorial Build a room/ }).tap()
    await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).tap()
    await waitForAction(page, 'intro.start')
    await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const useEditorStore = window.__stores.editor
      const project = useProjectStore.getState()
      const progress = project.workflow.tutorial
      if (!progress || progress.version !== 2 || !('currentActionId' in progress)) throw new Error('Tutorial v2 was not started')
      project.setWorkflow({
        ...project.workflow,
        tutorial: {
          ...progress,
          currentActionId: 'finish.export',
          actions: {
            ...progress.actions,
            'finish.review': {
              status: 'confirmed',
              evidence: { kind: 'phone-surface-test-prerequisite', sceneId: progress.sceneId },
            },
          },
        },
      })
      useEditorStore.getState().setWorkspaceMode('visualize')
    })

    await expect(page.getByRole('button', { name: 'Visualize', exact: true }).nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-visualize-bar]')).toBeVisible()
    await expect(page.locator('[data-tour="visualize-export-settings"]')).toBeVisible()
    await expect(page.locator('[data-tour="visualize-export-settings"]').getByRole('button', { name: 'Clay', exact: true })).toBeVisible()
  })

  test('draws and finishes an open camera path with touch controls', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Skip', exact: true }).tap()
    await page.getByRole('button', { name: /Tutorial Build a room/ }).tap()
    await page.getByRole('dialog', { name: 'Make your first camera move' }).getByRole('button', { name: 'Start lesson' }).tap()
    await waitForAction(page, 'intro.start')
    await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const useEditorStore = window.__stores.editor
      const project = useProjectStore.getState()
      const progress = project.workflow.tutorial
      if (!progress || progress.version !== 2 || !('currentActionId' in progress)) throw new Error('Tutorial v2 was not started')
      project.setWorkflow({
        ...project.workflow,
        tutorial: {
          ...progress,
          currentActionId: 'camera.path',
          actions: {
            ...progress.actions,
            'camera.select': {
              status: 'practiced',
              evidence: { kind: 'phone-surface-test-prerequisite', sceneId: progress.sceneId },
            },
          },
        },
      })
      useEditorStore.getState().setWorkspaceMode('compose')
    })

    const add = page.getByRole('button', { name: 'Add', exact: true })
    await expect(add).toHaveAttribute('aria-pressed', 'true')
    await collapseLesson(page)
    await page.getByRole('button', { name: 'Top', exact: true }).tap()
    await expect.poll(async () => page.evaluate(async () => {
      const useEditorStore = window.__stores.editor
      return useEditorStore.getState().viewRequest?.view
    })).toBe('top')
    await page.locator('[data-tour="pen-tool"]').tap()
    await closePhoneTask(page, 'Add')

    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    await page.touchscreen.tap(box!.x + box!.width * 0.38, box!.y + box!.height * 0.48)
    await page.touchscreen.tap(box!.x + box!.width * 0.62, box!.y + box!.height * 0.52)
    const drawState = await page.evaluate(async () => {
      const usePathStore = window.__stores.path
      const pathStore = usePathStore.getState()
      const path = pathStore.paths.find((item) => item.id === pathStore.activePathId)
      return path?.anchors.length
    })
    expect(drawState).toBe(2)
    await expect(page.locator('[data-tour="phone-finish-path"]')).toBeVisible()
    await page.locator('[data-tour="phone-finish-path"]').tap()
    await waitForStatus(page, 'camera.path', 'practiced')

    const pathState = await page.evaluate(async () => {
      const usePathStore = window.__stores.path
      const pathStore = usePathStore.getState()
      const path = pathStore.paths.find((item) => item.id === pathStore.activePathId)
      return path && { count: path.anchors.length, closed: path.closed }
    })
    expect(pathState).toEqual({ count: 2, closed: false })
  })

  test('completes the first camera-move lesson as one touch journey', async ({ page, browserName }, info) => {
    test.setTimeout(240_000)
    page.setDefaultTimeout(12_000)
    test.skip(browserName !== 'chromium', 'The continuous journey uses Chromium multi-touch dispatch')
    await page.goto('/')
    await page.getByRole('button', { name: 'Skip', exact: true }).tap()
    await page.getByRole('button', { name: /Tutorial Build a room/ }).tap()
    const preview = page.getByRole('dialog', { name: 'Make your first camera move' })
    await preview.getByRole('button', { name: 'Start lesson' }).tap()
    const lesson = page.getByRole('region', { name: 'Guided lesson' })
    await waitForAction(page, 'intro.start')
    await waitForStatus(page, 'intro.start', 'practiced')
    const projectId = await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      return useProjectStore.getState().projectId
    })
    await continueAction(page, 'intro.start', 'navigate.view')

    // Practice orbit, two-finger pan and pinch on the actual working viewport.
    await collapseLesson(page)
    const viewport = page.locator('canvas').first()
    await expect(viewport).toBeVisible()
    const view = await viewport.boundingBox()
    expect(view).not.toBeNull()
    const orbitFrom = { x: view!.x + view!.width * 0.52, y: view!.y + view!.height * 0.45 }
    await touchDrag(page, orbitFrom, { x: orbitFrom.x + 22, y: orbitFrom.y + 11 })
    const panFrom = [
      { x: view!.x + view!.width * 0.42, y: view!.y + view!.height * 0.42 },
      { x: view!.x + view!.width * 0.52, y: view!.y + view!.height * 0.48 },
    ]
    await touchMultiGesture(page, panFrom, panFrom.map((point) => ({ x: point.x + 14, y: point.y + 9 })))
    await touchMultiGesture(page,
      [{ x: orbitFrom.x - 24, y: orbitFrom.y }, { x: orbitFrom.x + 24, y: orbitFrom.y }],
      [{ x: orbitFrom.x - 34, y: orbitFrom.y }, { x: orbitFrom.x + 34, y: orbitFrom.y }],
    )
    await expandLesson(page)
    await lesson.getByRole('button', { name: 'I practiced these controls' }).tap()
    await waitForStatus(page, 'navigate.view', 'confirmed')
    await continueAction(page, 'navigate.view', 'navigate.recover')

    // Select/frame, move, undo, and explicitly remove only the lesson cube.
    await openPhoneTask(page, 'Scene')
    const cubeRow = page.locator('[data-tour="practice-cube-row"]')
    await expect(cubeRow).toBeVisible()
    await cubeRow.locator('button').first().tap()
    await openPhoneTask(page, 'Add')
    await page.getByRole('button', { name: 'Frame selected objects' }).tap()
    await page.getByTitle('Center the view on the world origin (H)').tap()
    await closePhoneTask(page, 'Add')
    await collapseLesson(page)
    const cubeStart = await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const useSceneStore = window.__stores.scene
      const editorCameraRef = window.__editorCameraRef
      const objectGroups = window.__objectGroups
      const id = (useProjectStore.getState().workflow.tutorial as { artifacts: { practiceCubeId: string } }).artifacts.practiceCubeId
      const object = useSceneStore.getState().objects.find((item) => item.id === id)!
      const group = objectGroups.get(id)!
      const camera = editorCameraRef.current!
      group.updateWorldMatrix(true, true)
      camera.updateMatrixWorld(true)
      const body = group.position.clone()
      body.y += 0.5
      body.project(camera)
      const canvas = document.querySelector<HTMLCanvasElement>('canvas')!
      const rect = canvas.getBoundingClientRect()
      return {
        id,
        position: object.transform.position,
        x: rect.left + (body.x + 1) * rect.width / 2,
        y: rect.top + (1 - body.y) * rect.height / 2,
      }
    })
    await touchDrag(page, { x: cubeStart.x, y: cubeStart.y }, { x: cubeStart.x + 28, y: cubeStart.y - 10 })
    const movedCube = await page.evaluate(async (id) => {
      const useSceneStore = window.__stores.scene
      return useSceneStore.getState().objects.find((item) => item.id === id)?.transform.position
    }, cubeStart.id)
    expect(movedCube).not.toEqual(cubeStart.position)
    await openPhoneTask(page, 'Add')
    await page.getByTitle('Undo (Ctrl+Z)').tap()
    await closePhoneTask(page, 'Add')
    await expect.poll(async () => page.evaluate(async (id) => {
      const useSceneStore = window.__stores.scene
      return useSceneStore.getState().objects.find((item) => item.id === id)?.transform.position
    }, cubeStart.id)).toEqual(cubeStart.position)
    await openPhoneTask(page, 'Scene')
    await cubeRow.getByRole('button', { name: 'Delete object' }).tap()
    await cubeRow.getByRole('button', { name: 'Delete?' }).tap()
    await waitForStatus(page, 'navigate.recover', 'practiced')
    await continueAction(page, 'navigate.recover', 'room.create')

    // Create, edit, save and insert the seeded Plan using its real 2D editor.
    await openControl(page)
    await page.locator('[data-tour="library-new-plan"]').tap()
    await expect(page.getByRole('region', { name: '2D floor plan editor' })).toBeVisible()
    await waitForStatus(page, 'room.create', 'practiced')
    await continueAction(page, 'room.create', 'room.edit')
    await collapseLesson(page)
    const corner = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="2D floor plan"]')!
      const plan = window.__planEditorStore.getState().plan
      const xs = plan.walls.flatMap((wall) => [wall.a.x, wall.b.x])
      const ys = plan.walls.flatMap((wall) => [wall.a.y, wall.b.y])
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
      const scale = Math.max(14, Math.min(160,
        (canvas.clientWidth - 180) / Math.max(0.5, maxX - minX),
        (canvas.clientHeight - 180) / Math.max(0.5, maxY - minY)))
      const offsetX = canvas.clientWidth / 2 - ((minX + maxX) / 2) * scale
      const offsetY = canvas.clientHeight / 2 - ((minY + maxY) / 2) * scale
      const rect = canvas.getBoundingClientRect()
      return { x: rect.left + offsetX + maxX * scale, y: rect.top + offsetY + maxY * scale }
    })
    await touchDrag(page, { x: corner.x + 10, y: corner.y + 10 }, { x: corner.x + 18, y: corner.y + 18 })
    await page.getByRole('button', { name: 'Save', exact: true }).tap()
    await waitForStatus(page, 'room.edit', 'practiced')
    await continueAction(page, 'room.edit', 'room.door')
    await page.locator('[data-tour="plan-door"]').tap()
    await collapseLesson(page)
    const wallMidpoint = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="2D floor plan"]')!
      const plan = window.__planEditorStore.getState().plan
      const xs = plan.walls.flatMap((wall) => [wall.a.x, wall.b.x])
      const ys = plan.walls.flatMap((wall) => [wall.a.y, wall.b.y])
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
      const scale = Math.max(14, Math.min(160,
        (canvas.clientWidth - 180) / Math.max(0.5, maxX - minX),
        (canvas.clientHeight - 180) / Math.max(0.5, maxY - minY)))
      const offsetX = canvas.clientWidth / 2 - ((minX + maxX) / 2) * scale
      const offsetY = canvas.clientHeight / 2 - ((minY + maxY) / 2) * scale
      const wall = plan.walls[0]!
      const rect = canvas.getBoundingClientRect()
      return {
        x: rect.left + offsetX + ((wall.a.x + wall.b.x) / 2) * scale,
        y: rect.top + offsetY + ((wall.a.y + wall.b.y) / 2) * scale,
      }
    })
    await page.touchscreen.tap(wallMidpoint.x, wallMidpoint.y)
    await expect.poll(async () => page.evaluate(() => {
      return window.__planEditorStore.getState().plan.openings.length
    })).toBe(1)
    await page.getByRole('button', { name: 'Save', exact: true }).tap()
    await waitForStatus(page, 'room.door', 'practiced')
    await continueAction(page, 'room.door', 'room.insert')
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
    const insertPlan = page.locator('[data-tour="library-insert-plan"]')
    await expect(insertPlan).toBeVisible()
    await insertPlan.tap()
    await waitForStatus(page, 'room.insert', 'practiced')

    // Refine the inserted copy from the phone Director task sheet before
    // moving on to the Figure authoring controls.
    await continueAction(page, 'room.insert', 'room.scene-edit')
    await openPhoneTask(page, 'Director')
    await page.getByRole('button', { name: 'Edit Plan' }).tap()
    await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const useSceneStore = window.__stores.scene
      const useEditorStore = window.__stores.editor
      const { planFromJSON } = await import('/src/lib/floorPlanModel.ts')
      const tutorial = useProjectStore.getState().workflow.tutorial as { artifacts: { planObjectId: string } }
      const object = useSceneStore.getState().objects.find((item) => item.id === tutorial.artifacts.planObjectId)!
      useEditorStore.getState().setScenePlanTarget({ kind: 'wall', wallId: planFromJSON(object.plan!).walls[0]!.id })
    })
    const scenePlanHeight = page.getByRole('slider', { name: 'Wall height' })
    await expect(scenePlanHeight).toBeVisible()
    await touchRangeValue(page, scenePlanHeight, 3)
    await waitForStatus(page, 'room.scene-edit', 'practiced')
    await continueAction(page, 'room.scene-edit', 'figure.add')

    // Add, position and pose one Figure through touch authoring controls.
    await openControl(page)
    await openPhoneTask(page, 'Add')
    await page.locator('[data-tour="figures-drawer"]').tap()
    await page.locator('[data-primitive="female"]').tap()
    await waitForStatus(page, 'figure.add', 'practiced')
    await continueAction(page, 'figure.add', 'figure.place')
    await openPhoneTask(page, 'Add')
    await collapseLesson(page)
    await page.getByTitle('Move (W)').tap()
    await closePhoneTask(page, 'Add')
    await collapseLesson(page)
    const figureStart = await page.evaluate(async () => {
      const useProjectStore = window.__stores.project
      const useSceneStore = window.__stores.scene
      const editorCameraRef = window.__editorCameraRef
      const objectGroups = window.__objectGroups
      const id = (useProjectStore.getState().workflow.tutorial as { artifacts: { figureId: string } }).artifacts.figureId
      const object = useSceneStore.getState().objects.find((item) => item.id === id)!
      const group = objectGroups.get(id)!
      const camera = editorCameraRef.current!
      group.updateWorldMatrix(true, true)
      camera.updateMatrixWorld(true)
      const body = group.position.clone()
      body.y += 1.6
      body.project(camera)
      const rect = document.querySelector<HTMLCanvasElement>('canvas')!.getBoundingClientRect()
      return {
        id,
        position: object.transform.position,
        x: rect.left + (body.x + 1) * rect.width / 2,
        y: rect.top + (1 - body.y) * rect.height / 2,
      }
    })
    await touchDrag(page, { x: figureStart.x, y: figureStart.y }, { x: figureStart.x + 28, y: figureStart.y - 10 })
    await expect.poll(async () => page.evaluate(async (id) => {
      const useSceneStore = window.__stores.scene
      return useSceneStore.getState().objects.find((item) => item.id === id)?.transform.position
    }, figureStart.id)).not.toEqual(figureStart.position)
    await waitForStatus(page, 'figure.place', 'practiced')
    await continueAction(page, 'figure.place', 'figure.pose')
    await openPhoneTask(page, 'Director')
    await collapseLesson(page)
    const armRaise = page.locator('[data-tour="figure-pose"]').getByRole('slider', { name: 'Left arm Raise' })
    await expect(armRaise).toBeVisible()
    const armBox = await armRaise.boundingBox()
    expect(armBox).not.toBeNull()
    await page.touchscreen.tap(armBox!.x + armBox!.width * 0.85, armBox!.y + armBox!.height / 2)
    await waitForStatus(page, 'figure.pose', 'practiced')

    // Select and name the starter camera, then draw and finish a two-point route.
    await continueAction(page, 'figure.pose', 'camera.select')
    await openControl(page)
    await openPhoneTask(page, 'Scene')
    const cameraRow = page.locator('[data-tour="tutorial-camera-option"]')
    await expect(cameraRow).toBeVisible()
    await collapseLesson(page)
    await cameraRow.locator('button').first().tap()
    await cameraRow.getByRole('button', { name: 'Rename camera' }).tap()
    const cameraName = cameraRow.locator('input')
    await cameraName.fill('Room entrance')
    await cameraName.press('Enter')
    await waitForStatus(page, 'camera.select', 'practiced')
    await closeOpenPhoneTask(page)
    await expandLesson(page)
    await continueAction(page, 'camera.select', 'camera.path')
    await openControl(page)
    await openPhoneTask(page, 'Add')
    await collapseLesson(page)
    await expect(page.getByRole('heading', { name: 'Add an Object' })).toBeVisible()
    await page.getByRole('button', { name: 'Top', exact: true }).tap()
    await page.locator('[data-tour="pen-tool"]').tap()
    await closePhoneTask(page, 'Add')
    await collapseLesson(page)
    const pathCanvas = page.locator('canvas').first()
    const pathBox = await pathCanvas.boundingBox()
    expect(pathBox).not.toBeNull()
    await page.touchscreen.tap(pathBox!.x + pathBox!.width * 0.38, pathBox!.y + pathBox!.height * 0.48)
    await page.touchscreen.tap(pathBox!.x + pathBox!.width * 0.62, pathBox!.y + pathBox!.height * 0.52)
    await page.locator('[data-tour="phone-finish-path"]').tap()
    await waitForStatus(page, 'camera.path', 'practiced')

    // Raise the route in its path inspector and inspect it through the shot camera.
    await continueAction(page, 'camera.path', 'camera.height')
    await openPhoneTask(page, 'Director')
    await closePhoneTask(page, 'Director')
    const revealPathHeight = lesson.getByRole('button', { name: 'Open control' })
    if (await revealPathHeight.isVisible()) await revealPathHeight.tap()
    await openPhoneTask(page, 'Director')
    await collapseLesson(page)
    const pathHeight = page.locator('[data-tour="path-height"] input[type="range"]')
    await expect(pathHeight).toBeVisible()
    const heightControlIsInScrollView = () => pathHeight.evaluate((element) => {
      let container = element.parentElement
      while (container && !container.classList.contains('overflow-y-auto')) container = container.parentElement
      if (!container) return false
      const control = element.getBoundingClientRect()
      const viewport = container.getBoundingClientRect()
      return control.top >= viewport.top && control.bottom <= viewport.bottom
    })
    await expect.poll(heightControlIsInScrollView).toBe(true)
    const heightBox = await pathHeight.boundingBox()
    expect(heightBox).not.toBeNull()
    await page.touchscreen.tap(heightBox!.x + heightBox!.width * 0.575, heightBox!.y + heightBox!.height / 2)
    await expect.poll(async () => Number(await pathHeight.inputValue())).toBeGreaterThan(1.2)
    await waitForStatus(page, 'camera.height', 'practiced')
    await continueAction(page, 'camera.height', 'camera.frame')
    await openPhoneTask(page, 'Director')
    await collapseLesson(page)
    await page.getByRole('button', { name: 'Look through', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Return to editor' })).toBeVisible()
    await page.getByRole('button', { name: 'Return to editor' }).tap()
    await closePhoneTask(page, 'Director')
    const revealCameraTarget = lesson.getByRole('button', { name: 'Open control' })
    if (await revealCameraTarget.isVisible()) await revealCameraTarget.tap()
    await openPhoneTask(page, 'Director')
    await collapseLesson(page)
    await closeOpenPhoneTask(page)
    await expandLesson(page)
    await expect(lesson.getByRole('button', { name: 'I checked the shot' })).toBeEnabled()
    await lesson.getByRole('button', { name: 'I checked the shot' }).tap()
    await waitForStatus(page, 'camera.frame', 'confirmed')

    // Set six seconds, scrub and play, then add two real camera FOV keys.
    await continueAction(page, 'camera.frame', 'timing.duration')
    await openPhoneTask(page, 'Timeline')
    await collapseLesson(page)
    const duration = page.getByRole('spinbutton', { name: 'Shot duration in seconds' })
    await expect(duration).toBeVisible()
    await duration.fill('7')
    await duration.fill('6')
    const ruler = page.getByLabel('Time ruler')
    await expect(ruler).toBeVisible()
    await ruler.tap({ position: { x: 8, y: 12 } })
    await ruler.tap({ position: { x: 0.92 * (await ruler.boundingBox())!.width, y: 12 } })
    const playPause = page.getByRole('button', { name: 'Play / Pause (Space)' })
    await playPause.tap()
    await page.waitForTimeout(250)
    await playPause.tap()
    await waitForStatus(page, 'timing.duration', 'practiced')
    await continueAction(page, 'timing.duration', 'timing.lens')
    await openPhoneTask(page, 'Director')
    await openPhoneTask(page, 'Timeline')
    await collapseLesson(page)
    const fovRuler = page.getByLabel('Time ruler')
    await fovRuler.tap({ position: { x: 1, y: 12 } })
    await expect.poll(async () => page.evaluate(async () => {
      const useRigStore = window.__stores.rig
      return useRigStore.getState().t
    })).toBeLessThanOrEqual(0.02)
    await openPhoneTask(page, 'Director')
    const revealFov = lesson.getByRole('button', { name: 'Open control' })
    if (await revealFov.isVisible()) await revealFov.tap()
    await openPhoneTask(page, 'Director')
    if (await lesson.getByRole('button', { name: 'Collapse lesson instructions' }).isVisible()) {
      await collapseLesson(page)
    }
    const fov = page.locator('[data-tour="camera-fov"] input[type="range"]')
    const addFovKey = page.locator('[data-tour="camera-fov"]').getByRole('button', {
      name: 'Add a keyframe for this property at the playhead (I)',
    })
    await expect(fov).toBeVisible()
    await touchRangeValue(page, fov, 45)
    await addFovKey.tap()
    const startFovKeyRecorded = await page.evaluate(async () => {
      const useRigStore = window.__stores.rig
      return useRigStore.getState().fovKeys.some((key) => key.time <= 0.02 && Math.abs(key.value - 45) <= 2)
    })
    expect(startFovKeyRecorded).toBe(true)
    await openPhoneTask(page, 'Timeline')
    const lensRuler = page.getByLabel('Time ruler')
    await lensRuler.tap({ position: { x: 0.99 * (await lensRuler.boundingBox())!.width, y: 12 } })
    await expect.poll(async () => page.evaluate(async () => {
      const useRigStore = window.__stores.rig
      return useRigStore.getState().t
    })).toBeGreaterThanOrEqual(0.98)
    await openPhoneTask(page, 'Director')
    await touchRangeValue(page, fov, 40)
    await addFovKey.tap()
    const endFovKeyRecorded = await page.evaluate(async () => {
      const useRigStore = window.__stores.rig
      return useRigStore.getState().fovKeys.some((key) => key.time >= 0.98 && Math.abs(key.value - 40) <= 2)
    })
    expect(endFovKeyRecorded).toBe(true)
    await waitForStatus(page, 'timing.lens', 'practiced')

    // Review and configure the requested export; skip encoding in this browser run.
    await continueAction(page, 'timing.lens', 'finish.review')
    await openControl(page)
    await openPhoneTask(page, 'Visualize')
    await collapseLesson(page)
    const previewPlay = page.getByRole('button', { name: 'Play / Pause (Space)' })
    await previewPlay.tap()
    await page.waitForTimeout(250)
    await previewPlay.tap()
    await closeOpenPhoneTask(page)
    await expandLesson(page)
    await lesson.getByRole('button', { name: 'I reviewed this' }).tap()
    await waitForStatus(page, 'finish.review', 'confirmed')
    await continueAction(page, 'finish.review', 'finish.export')
    await openControl(page)
    await openPhoneTask(page, 'Visualize')
    await collapseLesson(page)
    const exportSettings = page.locator('[data-tour="visualize-export-settings"]')
    await exportSettings.getByRole('button', { name: 'Clay', exact: true }).tap()
    await exportSettings.getByRole('button', { name: '16:9', exact: true }).tap()
    await exportSettings.getByRole('button', { name: '720p', exact: true }).tap()
    await closeOpenPhoneTask(page)
    await expandLesson(page)
    // No file was rendered; pressing Continue skips the optional export and advances.
    await continueAction(page, 'finish.export', 'finish.return')
    await waitForStatus(page, 'finish.export', 'skipped')
    await openControl(page)
    await expect(page.locator(`[data-project-id="${projectId}"]`)).toBeVisible()
    await waitForStatus(page, 'finish.return', 'practiced')
    await lesson.getByRole('button', { name: 'Finish lesson' }).tap()
    const summary = page.getByRole('region', { name: 'Tutorial summary' })
    await expect(summary.getByText(/Export: skipped/)).toBeVisible()
    await summary.getByRole('button', { name: 'Reopen Tutorial' }).tap()
    await expect(page.getByRole('region', { name: 'Tutorial summary' })).toBeVisible()
    await page.screenshot({ path: info.outputPath('tutorial-phone-complete-summary.png') })
  })
})
