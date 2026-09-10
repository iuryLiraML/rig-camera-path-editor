import { expect, test, type Download } from '@playwright/test'

for (const fallback of [false, true]) {
  test(`exports or reports unavailable encoding with ${fallback ? 'browser recording fallback' : 'native encoder'}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1024, height: 700 })
    if (fallback) await page.addInitScript(() => { Object.defineProperty(window, 'VideoEncoder', { value: undefined, configurable: true }) })
    await page.goto('/#/build')
    await expect(page.getByTitle('Back to Home')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(async () => {
      const { useRigStore } = await import('/src/state/useRigStore.ts')
      const { useEditorStore } = await import('/src/state/useEditorStore.ts')
      useRigStore.setState({ cameraKind: 'static', duration: 0.25, fps: 24, t: 0.4 })
      useEditorStore.setState({ workspaceMode: 'visualize', exportPasses: ['clay', 'depth'], exportRes: 'custom', customSize: [320, 180] })
    })
    const recordingSupported = await page.evaluate(() =>
      typeof MediaRecorder !== 'undefined' && ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'].some((mime) => MediaRecorder.isTypeSupported(mime)),
    )
    const diagnostics: string[] = []
    page.on('console', (event) => { if (event.type() === 'error') diagnostics.push(event.text()) })
    const downloads: Download[] = []
    page.on('download', (download) => downloads.push(download))
    await page.getByRole('button', { name: 'Export video', exact: true }).click()
    // This Playwright WebKit has no MediaRecorder constructor at all. Native
    // export is WebCodecs (GStreamer H.264 once the encoder/muxer plugins are
    // on GST_PLUGIN_PATH); only the stubbed-VideoEncoder case should stop on
    // the unsupported-recording notice.
    if (fallback && !recordingSupported && info.project.name === 'webkit' && process.platform === 'linux') {
      await expect(page.getByText('Video recording is not supported in this browser', { exact: true })).toBeVisible()
      expect(await page.evaluate(async () => {
        const { useEditorStore } = await import('/src/state/useEditorStore.ts')
        const { useRigStore } = await import('/src/state/useRigStore.ts')
        return { recording: useEditorStore.getState().recording, t: useRigStore.getState().t }
      })).toEqual({ recording: false, t: 0.4 })
      expect(downloads).toHaveLength(0)
      info.annotations.push({
        type: 'environment',
        description:
          'This Playwright WebKit has no MediaRecorder; fallback notice verified. Native WebCodecs export is a separate case.',
      })
      return
    }
    await expect.poll(async () => ({
      downloads: downloads.length,
      state: await page.evaluate(async () => {
        const { useEditorStore } = await import('/src/state/useEditorStore.ts')
        const { useSceneStore } = await import('/src/state/useSceneStore.ts')
        return { recording: useEditorStore.getState().recording, notice: useSceneStore.getState().notice }
      }),
      errors: diagnostics,
    }), { timeout: 20_000 }).toMatchObject({ downloads: 2 })
    for (const download of downloads) {
      expect(await download.failure()).toBeNull()
      await download.saveAs(info.outputPath(download.suggestedFilename()))
    }
    expect(downloads.map((d) => d.suggestedFilename())).toEqual([
      expect.stringMatching(/^camera-animation_clay\.(mp4|webm)$/),
      expect.stringMatching(/^camera-animation_depth\.(mp4|webm)$/),
    ])
    await expect(page.getByRole('button', { name: 'Export video', exact: true })).toBeVisible()
    expect(await page.evaluate(async () => {
      const { useRigStore } = await import('/src/state/useRigStore.ts')
      const { useEditorStore } = await import('/src/state/useEditorStore.ts')
      return { t: useRigStore.getState().t, recording: useEditorStore.getState().recording, playMode: useEditorStore.getState().playMode }
    })).toEqual({ t: 0.4, recording: false, playMode: false })
  })
}
