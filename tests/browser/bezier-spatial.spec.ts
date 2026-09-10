import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 } })
test.setTimeout(60_000)

async function prepare(page: Page, parented = false) {
  await page.goto('/#/build')
  await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(async (parented) => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const { useEditorStore } = await import('/src/state/useEditorStore.ts')
    const { useRigStore } = await import('/src/state/useRigStore.ts')
    const { useSceneStore } = await import('/src/state/useSceneStore.ts')
    const p = usePathStore.getState(), e = useEditorStore.getState()
    e.setWorkspaceMode('compose')
    e.setTool('select')
    e.setProjection('perspective')
    p.setPath([[-2, 1.8, -1], [-1, 1.8, 0], [0, 1.8, -1]], false)
    for (const a of p.getPath(p.activePathId)!.anchors) {
      p.setHandle(a.id, 'out', [.35, .15, 0], true)
      p.setHandle(a.id, 'in', [-.35, -.15, 0], true)
    }
    if (parented) {
      const scene = useSceneStore.getState()
      scene.addPrimitive('box')
      const object = useSceneStore.getState().objects.at(-1)!
      scene.setTransformAll(object.id, { position: [0, .2, 0], rotation: [0, 35, 15], scale: [1.5, .6, 2] })
      useRigStore.setState({ cameraPathId: p.activePathId, pathSpace: 'object', targetObjectId: object.id })
    }
    e.select('camera-path')
    p.selectAnchor(p.getPath(p.activePathId)!.anchors[1].id)
  }, parented)
  await page.waitForTimeout(400)
}

async function point(page: Page) {
  return page.evaluate(async () => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const { useSceneStore } = await import('/src/state/useSceneStore.ts')
    const { editorCameraRef } = await import('/src/viewport/EditorCamera.tsx')
    const { currentPathParentTransform } = await import('/src/lib/pathSpaceBind.ts')
    const { localPointToWorld } = await import('/src/lib/pathSpace.ts')
    const s = usePathStore.getState(), a = s.getPath(s.activePathId)!.anchors[1]
    const parent = currentPathParentTransform(s.activePathId, { objects: useSceneStore.getState().objects, paths: s.paths })
    const local = a.position.map((v, i) => v + a.handleOut[i]) as [number, number, number]
    const world = parent ? localPointToWorld(local, parent) : local
    const camera = editorCameraRef.current!, v = camera.position.clone().set(...world).project(camera)
    const rect = document.querySelector('canvas')!.getBoundingClientRect()
    const anchorWorld = parent ? localPointToWorld(a.position, parent) : a.position
    const anchorNdc = camera.position.clone().set(...anchorWorld).project(camera)
    const anchorPoint = { x: rect.left + (anchorNdc.x + 1) * rect.width / 2, y: rect.top + (1 - anchorNdc.y) * rect.height / 2 }
    return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2, world, anchor: a, anchorPoint }
  })
}

async function drag(page: Page, start: { x: number; y: number }, axis = '') {
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.tagName, start)).toBe('CANVAS')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  if (axis) await page.keyboard.press(axis)
  await page.mouse.move(start.x + 35, start.y - 25, { steps: 8 })
  await page.mouse.up()
}

for (const parented of [false, true]) {
  test(`edits a Free handle in perspective${parented ? ' under a rotated and scaled parent' : ''}`, async ({ page }) => {
    await prepare(page, parented)
    const before = await point(page)
    await drag(page, before)
    const after = await point(page)
    expect(after.x - before.x).toBeCloseTo(35, 0)
    expect(after.y - before.y).toBeCloseTo(-25, 0)
    expect(after.anchor.position).toEqual(before.anchor.position)
    expect(after.anchor.handleIn).toEqual(before.anchor.handleIn)
  })
}

test('constrains a handle to world X and releases navigation on mouse-up', async ({ page }) => {
  await prepare(page)
  const before = await point(page)
  await drag(page, before, 'x')
  const after = await point(page)
  expect(after.world[0]).not.toBeCloseTo(before.world[0], 4)
  expect(after.world[1]).toBeCloseTo(before.world[1], 8)
  expect(after.world[2]).toBeCloseTo(before.world[2], 8)
  expect(await page.evaluate(async () => (await import('/src/lib/orbitLock.ts')).isOrbitLocked())).toBe(false)
})

test('cancels and restores the gesture if the browser cancels the pointer', async ({ page }) => {
  await prepare(page)
  const before = await point(page)
  await page.mouse.move(before.x, before.y)
  await page.mouse.down()
  await page.mouse.move(before.x + 35, before.y - 25, { steps: 8 })
  expect((await point(page)).anchor.handleOut).not.toEqual(before.anchor.handleOut)
  await page.dispatchEvent('canvas', 'pointercancel', { pointerId: 1 })
  await page.mouse.up()
  expect((await point(page)).anchor).toEqual(before.anchor)
  expect(await page.evaluate(async () => (await import('/src/lib/orbitLock.ts')).isOrbitLocked())).toBe(false)
})

test('closes and reopens through the inspector, preserving manual handles', async ({ page }) => {
  await prepare(page)
  const before = (await point(page)).anchor
  await page.getByRole('button', { name: 'Yes', exact: true }).click()
  expect(await page.evaluate(async () => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const s = usePathStore.getState(); return s.getPath(s.activePathId)!.closed
  })).toBe(true)
  await page.getByRole('button', { name: 'No', exact: true }).click()
  expect(await page.evaluate(async () => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const s = usePathStore.getState(); return s.getPath(s.activePathId)!.closed
  })).toBe(false)
  expect((await point(page)).anchor).toEqual(before)
  await expect(page.getByRole('button', { name: 'Continue end', exact: true })).toBeVisible()
})

test('Shift-X constrains the handle to the world YZ plane', async ({ page }) => {
  await prepare(page)
  const before = await point(page)
  await drag(page, before, 'Shift+x')
  const after = await point(page)
  expect(after.world[0]).toBeCloseTo(before.world[0], 8)
  expect(Math.hypot(after.world[1] - before.world[1], after.world[2] - before.world[2])).toBeGreaterThan(.01)
})

test('Pen selects another path point without changing the camera-followed path', async ({ page }) => {
  await prepare(page)
  const ids = await page.evaluate(async () => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const { useRigStore } = await import('/src/state/useRigStore.ts')
    const p = usePathStore.getState(), original = p.activePathId
    const other = p.createPath('Other curve')
    p.setPath([[-4, 1.8, -1], [-3, 1.8, 0], [-2, 1.8, -1]], false)
    return { original, other, followed: useRigStore.getState().cameraPathId }
  })
  const other = await point(page)
  await page.evaluate(async ({ original }) => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const { useEditorStore } = await import('/src/state/useEditorStore.ts')
    usePathStore.getState().setActivePath(original)
    useEditorStore.getState().setTool('pen')
  }, ids)
  await page.mouse.click(other.anchorPoint.x, other.anchorPoint.y)
  await expect.poll(() => page.evaluate(async () => (await import('/src/state/usePathStore.ts')).usePathStore.getState().activePathId)).toBe(ids.other)
  expect(await page.evaluate(async () => (await import('/src/state/useRigStore.ts')).useRigStore.getState().cameraPathId)).toBe(ids.followed)
})

test('inserting and extending an existing curve preserve a Free camera', async ({ page }) => {
  await prepare(page)
  const before = await page.evaluate(async () => {
    const { useRigStore } = await import('/src/state/useRigStore.ts')
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const { buildCurve } = await import('/src/lib/curve.ts')
    const { editorCameraRef } = await import('/src/viewport/EditorCamera.tsx')
    useRigStore.getState().setCameraKind('static')
    const s = usePathStore.getState(), path = s.getPath(s.activePathId)!
    const v = buildCurve(path.anchors, path.closed, path.rounding)!.curves[0].getPoint(.5).project(editorCameraRef.current!)
    const rect = document.querySelector('canvas')!.getBoundingClientRect()
    return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2, pathId: useRigStore.getState().cameraPathId }
  })
  await page.keyboard.press('p')
  await page.keyboard.down('Control')
  await page.mouse.click(before.x, before.y)
  await page.keyboard.up('Control')
  const camera = () => page.evaluate(async () => {
    const r = (await import('/src/state/useRigStore.ts')).useRigStore.getState()
    return { kind: r.cameraKind, pathId: r.cameraPathId }
  })
  expect(await camera()).toEqual({ kind: 'static', pathId: before.pathId })
  await page.getByRole('button', { name: 'Continue end', exact: true }).click()
  await page.mouse.click(300, 220)
  expect(await camera()).toEqual({ kind: 'static', pathId: before.pathId })
  expect(await page.evaluate(async () => {
    const s = (await import('/src/state/usePathStore.ts')).usePathStore.getState()
    return s.getPath(s.activePathId)!.anchors.length
  })).toBe(5)
})

test('can draw again after deleting all points of a closed curve', async ({ page }) => {
  await prepare(page)
  await page.evaluate(async () => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const p = usePathStore.getState(), active = p.getPath(p.activePathId)!
    p.setClosed(true)
    p.setSelectedAnchorRefs(active.anchors.map(a => ({ pathId: active.id, anchorId: a.id })))
  })
  await page.keyboard.press('Delete')
  await page.keyboard.press('p')
  await page.waitForTimeout(400)
  await page.mouse.click(300, 220)
  expect(await page.evaluate(async () => {
    const s = (await import('/src/state/usePathStore.ts')).usePathStore.getState()
    const p = s.getPath(s.activePathId)!
    return { count: p.anchors.length, closed: p.closed }
  })).toEqual({ count: 1, closed: false })
})

test('inserts into a transformed curve without changing its world-space shape', async ({ page }) => {
  await prepare(page, true)
  const samples = () => page.evaluate(async () => {
    const { usePathStore } = await import('/src/state/usePathStore.ts')
    const { useSceneStore } = await import('/src/state/useSceneStore.ts')
    const { buildCurve } = await import('/src/lib/curve.ts')
    const { currentPathParentTransform } = await import('/src/lib/pathSpaceBind.ts')
    const { localPointToWorld } = await import('/src/lib/pathSpace.ts')
    const { editorCameraRef } = await import('/src/viewport/EditorCamera.tsx')
    const s = usePathStore.getState(), path = s.getPath(s.activePathId)!
    const parent = currentPathParentTransform(path.id, { objects: useSceneStore.getState().objects, paths: s.paths })!
    const curve = buildCurve(path.anchors, path.closed, path.rounding)!
    const world = localPointToWorld(curve.curves[0].getPoint(.5).toArray(), parent)
    const camera = editorCameraRef.current!, v = camera.position.clone().set(...world).project(camera)
    const rect = document.querySelector('canvas')!.getBoundingClientRect()
    return {
      x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2,
      count: path.anchors.length,
      points: Array.from({ length: 101 }, (_, i) => localPointToWorld(curve.getPointAt(i / 100).toArray(), parent)),
    }
  })
  const before = await samples()
  await page.keyboard.press('p')
  await page.keyboard.down('Control')
  await page.mouse.click(before.x, before.y)
  await page.keyboard.up('Control')
  const after = await samples()
  expect(after.count).toBe(before.count + 1)
  before.points.forEach((p, i) => expect(Math.hypot(...p.map((v, axis) => v - after.points[i][axis]))).toBeLessThan(.003))
})
