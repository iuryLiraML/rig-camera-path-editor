import { expect, test } from '@playwright/test'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf4sAAAAASUVORK5CYII=', 'base64')
function triangleGlb() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const document = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.byteLength }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] }
  const json = Buffer.from(JSON.stringify(document))
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded)
  const glb = Buffer.alloc(12 + 8 + padded.length + 8 + positions.byteLength)
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8)
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20)
  glb.writeUInt32LE(positions.byteLength, 20 + padded.length); glb.writeUInt32LE(0x004e4942, 24 + padded.length)
  Buffer.from(positions.buffer).copy(glb, 28 + padded.length)
  return glb
}

test('Home AI intake → reviewed scenes → generated and uploaded references → 3D Library result → reload', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/agent-config', (route) => route.fulfill({ json: { anthropic: true, fal: true } }))
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { email: 'production@example.test', loginConfigured: true } }))
  const draft = { name: 'Cafe film', guidelines: 'Quiet contemporary design',
    scenes: [{ sourceKey: 'cafe', name: 'Cafe' }, { sourceKey: 'street', name: 'Street' }],
    items: [{ sourceKey: 'chair', name: 'Cafe chair', kind: 'prop', provenance: 'explicit', quantity: 10,
      sceneSourceKeys: ['cafe'], prompt: 'One bentwood cafe chair', identityKey: 'chair', variantLabel: null, backgroundMode: null }] }
  let analyses = 0
  await page.route('**/api/anthropic/v1/messages', async (route) => {
    analyses++
    expect(route.request().postDataJSON().messages[0].content[0].text).toContain('Ten matching chairs')
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'proposal-1', name: 'propose_production_plan' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(draft) } },
      { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ]
    await route.fulfill({ contentType: 'text/event-stream', body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') })
  })
  const requests: { model: string; input: Record<string, unknown> }[] = []
  await page.route('**/api/fal/proxy', async (route) => {
    const target = route.request().headers()['x-fal-target-url'] ?? ''
    if (target.includes('/storage/upload/initiate')) return route.fulfill({ json: { upload_url: 'https://files.example/upload', file_url: 'https://files.example/uploaded.png' } })
    if (target.includes('/requests/') && target.includes('/status')) return route.fulfill({ json: { status: 'COMPLETED', request_id: 'test-job', logs: [] } })
    if (target.includes('/requests/')) return route.fulfill({ json: target.includes('tripo3d') ? { model_mesh: { url: 'https://files.example/model.glb' } } : { images: [{ url: 'https://files.example/generated.png' }] } })
    requests.push({ model: target, input: route.request().postDataJSON() })
    return route.fulfill({ json: { request_id: `test-job-${requests.length}`, status: 'IN_QUEUE' } })
  })
  await page.route('https://files.example/**', (route) => route.fulfill({
    contentType: route.request().url().endsWith('.glb') ? 'model/gltf-binary' : 'image/png',
    body: route.request().url().endsWith('.glb') ? triangleGlb() : png,
  }))
  await page.goto('/#/home')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await page.getByRole('button', { name: /New project/ }).first().click()
  await expect(page.getByRole('button', { name: /Blank scene/ })).toBeVisible()
  await page.getByRole('button', { name: /Start with AI Paste/ }).click()
  await page.getByLabel('Script or project description').fill('Ten matching chairs in a cafe. The second scene is in the street.')
  await page.getByRole('button', { name: 'Create production plan', exact: true }).click()
  await expect(page.getByLabel('Project name')).toHaveValue('Cafe film')
  await page.getByLabel('Scene 2').fill('Street at dawn')
  await expect(page).toHaveURL(/#\/home$/)
  expect(requests).toHaveLength(0)
  await page.getByRole('button', { name: 'Create project and review assets', exact: true }).click()
  await page.getByRole('button', { name: 'Cafe chair', exact: true }).click()
  await page.getByRole('button', { name: '3 3D review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Generate 3D assets', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '1 Requirements', exact: true }).click()
  await page.getByRole('button', { name: 'Approve requirement and prompt' }).click()
  await page.getByRole('button', { name: 'Continue to references', exact: true }).click()
  await page.getByRole('button', { name: 'Generate references', exact: true }).click()
  expect(requests).toHaveLength(0)
  await page.getByRole('button', { name: 'Confirm and generate', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Cafe chair reference', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByLabel('Upload reference image').setInputFiles({ name: 'manual-chair.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByRole('img', { name: 'manual-chair.png', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('button', { name: 'Continue to 3D review', exact: true }).click()
  await page.getByRole('button', { name: 'Generate 3D assets', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm and generate', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Cafe chair preview', exact: true })).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByText('Fulfilled by Cafe chair', { exact: true })).toBeVisible()
  await page.getByTitle('Close production list').click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Production list', exact: true }).click()
  await page.getByRole('button', { name: 'Cafe chair', exact: true }).click()
  await page.getByRole('button', { name: '3 3D review', exact: true }).click()
  await expect(page.getByText('Fulfilled by Cafe chair', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '2 References', exact: true }).click()
  await expect(page.getByRole('img', { name: 'manual-chair.png', exact: true })).toBeVisible()
  expect(analyses).toBe(1)
  expect(requests).toHaveLength(2)
  expect(requests[1].input).toMatchObject({ texture: false, pbr: false })
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('rig-db'); request.onsuccess = () => resolve(request.result) })
    const read = <T>(store: string) => new Promise<T[]>((resolve) => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result) })
    const projects = await read<{ scenes: { name: string }[] }>('projects')
    const assets = await read<{ name: string }>('library-palcos')
    const buffers = await read<ArrayBuffer>('model-buffers')
    db.close()
    return { scenes: projects[0].scenes.map((scene) => scene.name), projects: projects.length, assets: assets.length, mesh: buffers.some((buffer) => new DataView(buffer).getUint32(0, true) === 0x46546c67) }
  })
  expect(stored).toEqual({ scenes: ['Cafe', 'Street at dawn'], projects: 1, assets: 1, mesh: true })
  expect(errors).toEqual([])
  await page.screenshot({ path: '/tmp/rig-guided-production.png' })
})
