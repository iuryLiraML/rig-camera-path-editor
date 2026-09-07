import { expect, test, type Page } from '@playwright/test'

/** Generous authoring surface; top-row tests cover compact layouts separately. */
const WINDOW = { width: 1440, height: 900 }

/**
 * Anchor count straight from the store. Vite dev serves the same module
 * instance the app imported, so this observes real state instead of guessing
 * from panel copy that only changes at two anchors.
 */
async function activeTool(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const mod = await import('/src/state/useEditorStore.ts')
    return mod.useEditorStore.getState().tool
  })
}

async function anchorCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const mod = await import('/src/state/usePathStore.ts')
    const state = mod.usePathStore.getState()
    return state.getPath(state.activePathId)?.anchors.length ?? -1
  })
}

/** Isolate canvas authoring; the toolbar activation route is tested separately. */
async function openCompose(page: Page) {
  await page.goto('/')
  await expect(page.getByTitle('Back to projects')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(async () => {
    const mod = await import('/src/state/useEditorStore.ts')
    mod.useEditorStore.getState().setWorkspaceMode('compose')
    mod.useEditorStore.getState().setTool('pen')
  })
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const mod = await import('/src/state/useEditorStore.ts')
        const s = mod.useEditorStore.getState()
        return `${s.workspaceMode}/${s.tool}`
      }),
    )
    .toBe('compose/pen')
}

/** The Pen's live XYZ readout, which drei renders into the DOM at the ghost. */
const ghostReadout = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('div')).some((d) =>
      /^x -?\d+\.\d\d {2}y /.test(d.textContent ?? ''),
    ),
  )

/**
 * Place a point the way a person does: settle the pointer, let the preview
 * appear, then press. `mouse.click` alone moves and presses in the same tick,
 * so React had not committed the ghost yet and the click never met it — the
 * suite passed while the product dropped the first click of every gesture.
 * Also fails loudly if a panel covers the spot, so a miss cannot read as a
 * dead Pen.
 */
async function clickViewport(page: Page, x: number, y: number) {
  // Approach, then settle: one lone pointermove is a coin flip on whether the
  // preview has committed, and a hand never lands on the exact pixel in a
  // single event either.
  await page.mouse.move(x + 4, y + 4)
  await page.mouse.move(x, y)
  await expect.poll(() => ghostReadout(page), { timeout: 10_000 }).toBe(true)
  const tag = await page.evaluate(
    ([px, py]) => document.elementFromPoint(px as number, py as number)?.tagName,
    [x, y],
  )
  expect(tag).toBe('CANVAS')
  await page.mouse.click(x, y)
}

test.describe('Pen places points on the grid', () => {
  test.use({ viewport: WINDOW })

  test('the first click on the grid creates one anchor', async ({ page }) => {
    await openCompose(page)
    expect(await anchorCount(page)).toBe(0)

    await clickViewport(page, 300, 220)

    expect(await anchorCount(page)).toBe(1)
  })

  test('a second click on a different spot creates a second anchor', async ({ page }) => {
    await openCompose(page)

    await clickViewport(page, 300, 220)
    await clickViewport(page, 420, 300)

    expect(await anchorCount(page)).toBe(2)
    // A second point only lands if placing the first left the tool alone.
    expect(await activeTool(page)).toBe('pen')
  })

  test('the Pen activated from the toolbar button places on the first click', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTitle('Back to projects')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(async () => {
      const mod = await import('/src/state/useEditorStore.ts')
      mod.useEditorStore.getState().setWorkspaceMode('compose')
    })
    await page.getByTitle('Pen — click to place path points (P)').click()

    await clickViewport(page, 300, 220)

    expect(await anchorCount(page)).toBe(1)
  })

  test('picking the Pen while looking through the camera still places a point', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByTitle('Back to projects')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(async () => {
      const mod = await import('/src/state/useEditorStore.ts')
      const editor = mod.useEditorStore.getState()
      editor.setWorkspaceMode('compose')
      editor.setCameraView(true)
      editor.setTool('pen')
    })
    await page.waitForTimeout(300)

    await clickViewport(page, 300, 220)

    expect(await anchorCount(page)).toBe(1)
  })

  test('picking the Pen from a Depth pass still places a point', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTitle('Back to projects')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(async () => {
      const mod = await import('/src/state/useEditorStore.ts')
      const editor = mod.useEditorStore.getState()
      editor.setWorkspaceMode('compose')
      editor.setViewMode('depth')
      editor.setTool('pen')
    })
    await page.waitForTimeout(300)

    await clickViewport(page, 300, 220)

    expect(await anchorCount(page)).toBe(1)
  })

  test('a click on empty grid appends to a path that already has anchors', async ({ page }) => {
    await openCompose(page)
    await page.evaluate(async () => {
      const mod = await import('/src/state/usePathStore.ts')
      const path = mod.usePathStore.getState()
      path.addAnchor([-2, 0, -2])
      path.addAnchor([2, 0, 2])
    })
    expect(await anchorCount(page)).toBe(2)

    await clickViewport(page, 300, 220)

    expect(await anchorCount(page)).toBe(3)
  })
  test('clicks in the Front view create points and dragging pulls a handle', async ({ page }) => {
    await openCompose(page)
    await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/state/useEditorStore.ts')
      useEditorStore.getState().requestView('front')
    })
    await page.waitForTimeout(400)
    await clickViewport(page, 300, 220)
    expect(await anchorCount(page)).toBe(1)
    await page.mouse.move(420, 300)
    await page.mouse.down()
    await page.mouse.move(460, 320, { steps: 8 })
    await page.mouse.up()
    expect(await anchorCount(page)).toBe(2)
    expect(await page.evaluate(async () => {
      const { usePathStore } = await import('/src/state/usePathStore.ts')
      const s = usePathStore.getState()
      return s.getPath(s.activePathId)?.anchors[1].manual
    })).toBe(true)
  })

  test('clicking the first anchor closes the loop in a split editor pane', async ({ page }) => {
    await openCompose(page)
    await page.evaluate(async () => {
      const { useLayoutStore } = await import('/src/state/useLayoutStore.ts')
      useLayoutStore.getState().applyPreset('director', { v: 0.5, h: 0.5 })
    })
    await page.waitForTimeout(400)
    await clickViewport(page, 230, 220)
    await clickViewport(page, 350, 280)
    await clickViewport(page, 230, 360)
    expect(await anchorCount(page)).toBe(3)
    await page.mouse.click(230, 220)
    await expect.poll(() => activeTool(page)).toBe('select')
    expect(await anchorCount(page)).toBe(3)
    expect(await page.evaluate(async () => {
      const { usePathStore } = await import('/src/state/usePathStore.ts')
      const s = usePathStore.getState()
      return s.getPath(s.activePathId)?.closed
    })).toBe(true)
  })

})

async function controlsAt(page: Page, index: number) {
  return page.evaluate(async (index) => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const { computeAutoHandles } = await import('/src/lib/curve.ts')
    const { editorCameraRef } = await import('/src/viewport/EditorCamera.tsx')
    const state = usePathStore.getState(), path = state.getPath(state.activePathId)!
    const a = computeAutoHandles(path.anchors, path.closed, path.rounding)[index]
    const canvas = document.querySelector('canvas')!.getBoundingClientRect()
    const { computeRects, paneAt, useLayoutStore } = await import('/src/state/useLayoutStore.ts')
    const { spatialCameras, isSpatialView } = await import('/src/viewport/spatialViews.ts')
    const panes = [...computeRects(useLayoutStore.getState().root, { x: 0, y: 0, w: canvas.width, h: canvas.height }).leaves.values()]
    const pane = panes.find(p => paneAt(p.x + p.w / 2, p.y + p.h / 2, canvas.width, canvas.height)?.view !== 'camera')!
    const leaf = paneAt(pane.x + pane.w / 2, pane.y + pane.h / 2, canvas.width, canvas.height)!
    const camera = isSpatialView(leaf.view) ? spatialCameras[leaf.view] : editorCameraRef.current!
    const project = (values: number[]) => {
      const v = camera.position.clone().set(values[0], values[1], values[2]).project(camera)
      return { x: canvas.left + pane.x + (v.x + 1) * pane.w / 2, y: canvas.top + pane.y + (1 - v.y) * pane.h / 2 }
    }
    return { id: a.id, point: project(a.position), in: project(a.position.map((v, i) => v + a.handleIn[i])), out: project(a.position.map((v, i) => v + a.handleOut[i])), position: a.position, handleIn: a.handleIn, handleOut: a.handleOut }
  }, index)
}

async function dragControl(page: Page, start: { x: number; y: number }, dx: number, dy: number, cancel = false) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dx / 2, start.y + dy / 2, { steps: 4 })
  await page.waitForTimeout(450) // A slow gesture must still be a single Undo.
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 4 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
}

async function drawEditableCurve(page: Page) {
  await openCompose(page)
  for (const [x, y] of [[300, 240], [440, 330], [580, 240]]) {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 36, y - 24, { steps: 5 })
    await page.mouse.up()
  }
  await page.keyboard.press('Enter')
  await expect.poll(() => activeTool(page)).toBe('select')
  expect(await anchorCount(page)).toBe(3)
}

async function segmentLocation(page: Page, index = 0, t = .5) {
  return page.evaluate(async ({ index, t }) => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const { buildCurve } = await import('/src/lib/curve.ts')
    const { editorCameraRef } = await import('/src/viewport/EditorCamera.tsx')
    const s = usePathStore.getState(), path = s.getPath(s.activePathId)!
    const p = buildCurve(path.anchors, path.closed, path.rounding)!.curves[index].getPoint(t).project(editorCameraRef.current!)
    const rect = document.querySelector('canvas')!.getBoundingClientRect()
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 }
  }, { index, t })
}

async function geometry(page: Page) {
  return page.evaluate(async () => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const { buildCurve } = await import('/src/lib/curve.ts')
    const s = usePathStore.getState(), path = s.getPath(s.activePathId)!
    const curve = buildCurve(path.anchors, path.closed, path.rounding)!
    return { anchors: path.anchors, samples: Array.from({ length: 51 }, (_, i) => curve.getPointAt(i / 50).toArray()) }
  })
}

test.describe('Bézier editing after finishing the Pen stroke', () => {
  test.setTimeout(60_000)
  test.use({ viewport: WINDOW })

  test('selects a finished point and drags both handles with one Undo per gesture', async ({ page }) => {
    await drawEditableCurve(page)
    const first = await controlsAt(page, 1)
    await page.mouse.click(first.point.x, first.point.y)
    await page.waitForTimeout(100)
    await dragControl(page, first.out, 35, 28)
    const changed = await controlsAt(page, 1)
    expect(changed.position).toEqual(first.position)
    expect(changed.handleOut).not.toEqual(first.handleOut)
    expect(Math.hypot(...changed.handleIn)).toBeCloseTo(Math.hypot(...first.handleIn), 5)
    await page.keyboard.press('Control+z')
    expect((await controlsAt(page, 1)).handleOut).toEqual(first.handleOut)
    await page.keyboard.press('Control+Shift+z')
    expect((await controlsAt(page, 1)).handleOut).toEqual(changed.handleOut)
    await dragControl(page, changed.in, -25, 20)
    expect((await controlsAt(page, 1)).handleIn).not.toEqual(changed.handleIn)
    expect(await anchorCount(page)).toBe(3)
  })

  test('edits existing handles while Pen is active and cancels an unfinished drag', async ({ page }) => {
    await drawEditableCurve(page)
    const first = await controlsAt(page, 1)
    await page.mouse.click(first.point.x, first.point.y)
    await page.keyboard.press('p')
    await expect.poll(() => activeTool(page)).toBe('pen')
    await dragControl(page, first.out, 32, -20, true)
    expect((await controlsAt(page, 1)).handleOut).toEqual(first.handleOut)
    expect(await activeTool(page)).toBe('pen')
    await dragControl(page, first.out, 32, -20)
    expect((await controlsAt(page, 1)).handleOut).not.toEqual(first.handleOut)
    expect(await anchorCount(page)).toBe(3)
  })

  test('moves a finished anchor directly together with its relative handles', async ({ page }) => {
    await drawEditableCurve(page)
    const first = await controlsAt(page, 0)
    await dragControl(page, first.point, -25, 32)
    const moved = await controlsAt(page, 0)
    expect(moved.position).not.toEqual(first.position)
    expect(moved.handleIn).toEqual(first.handleIn)
    expect(moved.handleOut).toEqual(first.handleOut)
  })

  for (const view of ['front', 'right'] as const) {
    test(`edits handle height in ${view} view without forcing Top`, async ({ page }) => {
      await drawEditableCurve(page)
      const first = await controlsAt(page, 1)
      await page.mouse.click(first.point.x, first.point.y)
      await page.evaluate(async (view) => {
        const { useEditorStore } = await import('/src/state/useEditorStore.ts')
        useEditorStore.getState().requestView(view)
      }, view)
      await page.waitForTimeout(400)
      await page.keyboard.press('p')
      let controls = await controlsAt(page, 1)
      // In Right the path can project behind the bottom controls; pan it into the free area.
      if (controls.out.y > 480) {
        await page.keyboard.down('Shift')
        await page.mouse.move(300, 240)
        await page.mouse.down({ button: 'middle' })
        await page.mouse.move(300, 120, { steps: 6 })
        await page.mouse.up({ button: 'middle' })
        await page.keyboard.up('Shift')
        await page.waitForTimeout(200)
        controls = await controlsAt(page, 1)
      }
      expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.tagName, controls.out)).toBe('CANVAS')
      await dragControl(page, controls.out, 8, -35)
      const after = await controlsAt(page, 1)
      expect(after.handleOut[1]).not.toBeCloseTo(controls.handleOut[1], 3)
      expect(after.position).toEqual(controls.position)
      expect(await anchorCount(page)).toBe(3)
    })
  }

  test('edits a handle in a split viewport using the pane camera', async ({ page }) => {
    await drawEditableCurve(page)
    const first = await controlsAt(page, 1)
    await page.mouse.click(first.point.x, first.point.y)
    await page.evaluate(async () => {
      const { useLayoutStore } = await import('/src/state/useLayoutStore.ts')
      useLayoutStore.getState().applyPreset('director', { v: .5, h: .5 })
    })
    await page.waitForTimeout(400)
    const controls = await controlsAt(page, 1)
    await dragControl(page, controls.out, 24, 20)
    expect((await controlsAt(page, 1)).handleOut).not.toEqual(controls.handleOut)
    expect(await anchorCount(page)).toBe(3)
  })

  test('pulls a collapsed legacy handle from the point', async ({ page }) => {
    await drawEditableCurve(page)
    await page.evaluate(async () => {
      const { usePathStore } = await import('/src/state/usePathStore.ts')
      const s = usePathStore.getState(), active = s.getPath(s.activePathId)!
      s.setAnchorTangent(active.anchors[1].id, 'corner')
      s.selectAnchor(active.anchors[1].id)
    })
    const controls = await controlsAt(page, 1)
    await page.keyboard.down('Alt')
    await dragControl(page, controls.point, 40, -25)
    await page.keyboard.up('Alt')
    const after = await controlsAt(page, 1)
    expect(Math.hypot(...after.handleOut)).toBeGreaterThan(.01)
    expect(after.handleIn).toEqual([0, 0, 0])
    expect(after.position).toEqual(controls.position)
  })

  test('inserts on the curve without deforming it, then deletes and undoes the point', async ({ page }) => {
    await drawEditableCurve(page)
    const before = await geometry(page)
    const hit = await segmentLocation(page)
    await page.keyboard.press('p')
    await page.keyboard.down('Control')
    await page.mouse.click(hit.x, hit.y)
    await page.keyboard.up('Control')
    expect(await anchorCount(page)).toBe(4)
    const after = await geometry(page)
    for (let i = 0; i < before.samples.length; i++) {
      expect(Math.hypot(...before.samples[i].map((v, axis) => v - after.samples[i][axis]))).toBeLessThan(.003)
    }
    await page.keyboard.press('Delete')
    expect(await anchorCount(page)).toBe(3)
    await page.keyboard.press('Control+z')
    expect(await anchorCount(page)).toBe(4)
  })

  test('drags a segment while its anchors remain fixed', async ({ page }) => {
    await drawEditableCurve(page)
    const before = await geometry(page)
    await page.keyboard.press('p')
    await dragControl(page, await segmentLocation(page), 25, 35)
    const after = await geometry(page)
    expect(after.anchors.map(a => a.position)).toEqual(before.anchors.map(a => a.position))
    expect(after.samples).not.toEqual(before.samples)
    expect(await anchorCount(page)).toBe(3)
  })

  test('continues from the start through the inspector and pulls the incoming handle', async ({ page }) => {
    await drawEditableCurve(page)
    const before = await geometry(page)
    await page.getByRole('button', { name: 'Continue start', exact: true }).click()
    await dragControl(page, { x: 200, y: 200 }, 30, 25)
    const after = await geometry(page)
    expect(after.anchors.slice(1)).toEqual(before.anchors)
    expect(Math.hypot(...after.anchors[0].handleIn)).toBeGreaterThan(.01)
    expect(after.anchors[0].handleInType).toBe('aligned')
    expect(await anchorCount(page)).toBe(4)
  })

  test('shows handles in the inspector, saves, reloads and keeps editing', async ({ page }) => {
    test.setTimeout(60_000)
    await drawEditableCurve(page)
    const point = await controlsAt(page, 1)
    await page.mouse.click(point.point.x, point.point.y)
    await page.getByLabel('Show all handles', { exact: true }).check()
    await expect(page.getByText('Point 2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Free', exact: true }).click()
    await dragControl(page, point.out, 25, 20)
    const before = await geometry(page)
    const projectId = await page.evaluate(async () => {
      const { saveActiveProject } = await import('/src/lib/projects.ts')
      const { useProjectStore } = await import('/src/state/useProjectStore.ts')
      await saveActiveProject({ createIfMissing: true })
      return useProjectStore.getState().projectId!
    })
    await page.screenshot({ path: '/tmp/rig-bezier-editing.png' })
    await page.reload()
    await expect(page.getByTitle('Back to projects')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(async (id) => {
      const { switchProject } = await import('/src/lib/projects.ts')
      const { useEditorStore } = await import('/src/state/useEditorStore.ts')
      await switchProject(id)
      useEditorStore.getState().setWorkspaceMode('compose')
      useEditorStore.getState().requestView('top')
    }, projectId)
    // JSON persistence intentionally normalizes signed zero. All geometry and type fields must survive.
    expect((await geometry(page)).anchors).toEqual(JSON.parse(JSON.stringify(before.anchors)))
    await page.waitForTimeout(400)
    const restored = await controlsAt(page, 1)
    await page.mouse.click(restored.point.x, restored.point.y)
    await dragControl(page, restored.out, 20, 15)
    expect((await controlsAt(page, 1)).handleOut).not.toEqual(before.anchors[1].handleOut)
  })
})
