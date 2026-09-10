import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 } })

async function open(page: Page) {
  await page.goto('/#/build')
  await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/useEditorStore.ts')
    const e = useEditorStore.getState()
    e.setWorkspaceMode('compose')
    e.setTool('pen')
  })
  await page.waitForTimeout(400)
  await page.mouse.click(400, 260)
  await page.mouse.click(550, 320)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  expect(await page.evaluate(async () => {
    const p = (await import('/src/state/usePathStore.ts')).usePathStore.getState()
    return p.getPath(p.activePathId)!.anchors.length
  })).toBe(2)
}

async function drag(page: Page, x: number, y: number, button: 'left' | 'middle' | 'right') {
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x, y })).toBe('CANVAS')
  await page.mouse.move(x, y)
  await page.mouse.down({ button })
  await page.mouse.move(x + 65, y + 40, { steps: 10 })
  await page.mouse.up({ button })
  await page.waitForTimeout(250)
}

async function objects(page: Page) {
  await open(page)
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/useEditorStore.ts')
    const { useSceneStore } = await import('/src/state/useSceneStore.ts')
    const { editorCameraRef } = await import('/src/viewport/EditorCamera.tsx')
    const e = useEditorStore.getState(), s = useSceneStore.getState()
    e.setWorkspaceMode('build')
    e.setTool('select')
    const ids: string[] = []
    for (const x of [-1.5, 1.5]) {
      s.addPrimitive('box')
      const id = useSceneStore.getState().objects.at(-1)!.id
      s.setTransformAll(id, { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })
      ids.push(id)
    }
    e.select(`obj:${ids[0]}`)
    const c = editorCameraRef.current!, rect = document.querySelector('canvas')!.getBoundingClientRect()
    return ids.map((id, i) => {
      const v = c.position.clone().set(i === 0 ? -1.5 : 1.5, 0.5, 0).project(c)
      return { id, x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2 }
    })
  })
}

test('selects another object directly while the transform gizmo is visible', async ({ page }) => {
  const pts = await objects(page)
  await page.keyboard.press('w')
  await page.waitForTimeout(400)
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.tagName, pts[1])).toBe('CANVAS')
  await page.mouse.click(pts[1].x, pts[1].y)
  expect(await page.evaluate(async () => (await import('/src/state/useEditorStore.ts')).useEditorStore.getState().selection)).toBe(`obj:${pts[1].id}`)
})

const gestures = [
  { name: 'orbit', modifier: null },
  { name: 'pan', modifier: 'Shift' },
  { name: 'zoom', modifier: 'Control' },
] as const

async function navigationPose(page: Page) {
  return page.evaluate(() => {
    const { controls: c } = (window as any).__three()
    return { position: c.object.position.toArray(), rotation: c.object.quaternion.toArray(), target: c.target.toArray(), distance: c.object.position.distanceTo(c.target), zoom: c.object.zoom, orthographic: !!c.object.isOrthographicCamera }
  })
}

for (const context of ['finished Pen', 'active Pen', 'selected object'] as const) {
  for (const gesture of gestures) {
    test(`Blender ${gesture.name} over ${context}`, async ({ page }) => {
      let at = { x: 550, y: 320 }
      if (context === 'selected object') at = (await objects(page))[0]
      else {
        await open(page)
        if (context === 'active Pen') await page.keyboard.press('p')
      }
      await page.waitForTimeout(400)
      const before = await navigationPose(page)
      const content = await editingState(page)
      if (gesture.modifier) await page.keyboard.down(gesture.modifier)
      await drag(page, at.x, at.y, 'middle')
      if (gesture.modifier) await page.keyboard.up(gesture.modifier)
      const after = await navigationPose(page)
      expect(await editingState(page)).toEqual(content)
      if (gesture.name === 'orbit') {
        expect(after.rotation).not.toEqual(before.rotation)
        expect(after.target).toEqual(before.target)
      } else if (gesture.name === 'pan') {
        expect(after.target).not.toEqual(before.target)
        expect(after.distance).toBeCloseTo(before.distance, 6)
      } else {
        if (before.orthographic) expect(after.zoom).not.toBeCloseTo(before.zoom, 4)
        else expect(after.distance).not.toBeCloseTo(before.distance, 4)
        expect(after.target).toEqual(before.target)
      }
    })
  }
}


async function editingState(page: Page) {
  return page.evaluate(async () => {
    const p = (await import('/src/state/usePathStore.ts')).usePathStore.getState()
    const e = (await import('/src/state/useEditorStore.ts')).useEditorStore.getState()
    const s = (await import('/src/state/useSceneStore.ts')).useSceneStore.getState()
    return { paths: p.paths, selected: e.selectionIds, anchors: p.selectedAnchorRefs, objects: s.objects.map(o => ({ id: o.id, transform: o.transform })) }
  })
}

test('left drag on empty space does not orbit and wheel zoom works after Pen', async ({ page }) => {
  await open(page)
  const before = await navigationPose(page)
  await drag(page, 800, 280, 'left')
  expect(await navigationPose(page)).toEqual(before)
  await page.mouse.move(300, 220)
  expect(await page.evaluate(() => document.elementFromPoint(300, 220)?.tagName)).toBe('CANVAS')
  await page.mouse.wheel(0, 150)
  await page.waitForTimeout(250)
  expect(await navigationPose(page)).not.toEqual(before)
})

for (const mode of ['e', 'r']) {
  test(`switches object selection directly with ${mode} gizmo active`, async ({ page }) => {
    const pts = await objects(page)
    await page.keyboard.press(mode)
    await page.waitForTimeout(400)
    for (const point of [pts[1], pts[0]]) {
      await page.mouse.click(point.x, point.y)
      expect(await page.evaluate(async () => (await import('/src/state/useEditorStore.ts')).useEditorStore.getState().selection)).toBe(`obj:${point.id}`)
    }
  })
}

for (const end of ['release', 'cancel', 'blur'] as const) {
  test(`navigates after a point drag ends with ${end}`, async ({ page }) => {
    await open(page)
    await page.mouse.move(550, 320)
    await page.mouse.down()
    await page.mouse.move(590, 350, { steps: 5 })
    if (end === 'cancel') await page.dispatchEvent('canvas', 'pointercancel', { pointerId: 1 })
    if (end === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.mouse.up()
    const before = await navigationPose(page)
    const content = await editingState(page)
    await drag(page, 800, 280, 'middle')
    expect((await navigationPose(page)).rotation).not.toEqual(before.rotation)
    expect(await editingState(page)).toEqual(content)
  })
}

for (const interruption of ['blur', 'Escape', 'pointercancel', 'tool change'] as const) {
  test(`stops navigation on ${interruption} and can start another gesture`, async ({ page }) => {
    await open(page)
    // Isolate event cancellation from render-rate-dependent orbit damping.
    await page.evaluate(() => { (window as any).__three().controls.enableDamping = false })
    await page.mouse.move(800, 280)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(825, 290, { steps: 5 })
    if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    if (interruption === 'tool change') await page.keyboard.press('p')
    if (interruption === 'Escape') await page.keyboard.press('Escape')
    if (interruption === 'pointercancel') await page.dispatchEvent('canvas', 'pointercancel', { pointerId: 1 })
    await page.waitForTimeout(1000)
    const stopped = await navigationPose(page)
    await page.mouse.move(875, 320, { steps: 5 })
    await page.waitForTimeout(250)
    const moved = await navigationPose(page)
    for (let i = 0; i < 4; i++) expect(moved.rotation[i]).toBeCloseTo(stopped.rotation[i], 4)
    await page.mouse.up({ button: 'middle' })
    await drag(page, 800, 280, 'middle')
    expect((await navigationPose(page)).rotation).not.toEqual(moved.rotation)
  })
}


test('Blender mouse gestures also work in perspective', async ({ page }) => {
  await objects(page)
  await page.evaluate(async () => (await import('/src/state/useEditorStore.ts')).useEditorStore.getState().setProjection('perspective'))
  await page.waitForTimeout(400)
  for (const gesture of gestures) {
    const before = await navigationPose(page)
    expect(before.orthographic).toBe(false)
    if (gesture.modifier) await page.keyboard.down(gesture.modifier)
    await drag(page, 800, 280, 'middle')
    if (gesture.modifier) await page.keyboard.up(gesture.modifier)
    const after = await navigationPose(page)
    if (gesture.name === 'orbit') expect(after.rotation).not.toEqual(before.rotation)
    if (gesture.name === 'pan') expect(after.target).not.toEqual(before.target)
    if (gesture.name === 'zoom') expect(after.distance).not.toBeCloseTo(before.distance, 4)
  }
})

test('keeps navigation in its starting pane when crossing into the camera preview', async ({ page }) => {
  await open(page)
  await page.evaluate(async () => {
    (await import('/src/state/useLayoutStore.ts')).useLayoutStore.getState().applyPreset('director', { v: .5, h: .5 })
    ;(window as any).__three().controls.enableDamping = false
  })
  await page.waitForTimeout(400)
  const pose = () => page.evaluate(async () => {
    const { editorCameraRef } = await import('/src/viewport/EditorCamera.tsx')
    const { cinemaCameraRef } = await import('/src/viewport/rig/CinemaCamera.tsx')
    return { editor: editorCameraRef.current!.quaternion.toArray(), cinema: cinemaCameraRef.current!.quaternion.toArray() }
  })
  await page.mouse.move(650, 250)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(690, 270, { steps: 5 })
  const before = await pose()
  await page.mouse.move(820, 300, { steps: 10 })
  const after = await pose()
  await page.mouse.up({ button: 'middle' })
  expect(after.editor).not.toEqual(before.editor)
  expect(after.cinema).toEqual(before.cinema)
})


test('shows the Blender mouse shortcuts in a scrollable help dialog', async ({ page }) => {
  await open(page)
  await page.setViewportSize({ width: 1000, height: 650 })
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('MMB drag', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Shift+MMB drag', { exact: true })).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds!.y).toBeGreaterThanOrEqual(15)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(635)
  await dialog.getByTitle('Close (Esc)').click()
  await expect(dialog).not.toBeVisible()
})
