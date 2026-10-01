import { describe, expect, it } from 'vitest'
import { editorChrome, isCinemaViewport, isPathEditing, isPathStrokeTool, isSceneEditing, pathGuidesVisible } from './workspaceChrome'

describe('editorChrome', () => {
  it('hides every overlay in play mode', () => {
    const flags = editorChrome({
      playMode: true,
      workspaceMode: 'compose',
      composeDock: 'timeline',
      showOutliner: true,
      showAddDrawer: true,
    })
    expect(flags.timeline).toBe(false)
    expect(flags.visualizeRail).toBe(false)
    expect(flags.directorDock).toBe(false)
    expect(flags.toolbar).toBe(false)
  })

  it('Build shows the add drawer and object bar, not the timeline', () => {
    const flags = editorChrome({
      playMode: false,
      workspaceMode: 'build',
      composeDock: 'timeline',
      showOutliner: false,
      showAddDrawer: false,
    })
    expect(flags.addDrawer).toBe(true)
    expect(flags.objectBar).toBe(true)
    expect(flags.timeline).toBe(false)
    expect(flags.visualizeRail).toBe(false)
    expect(flags.directorDock).toBe(true)
    expect(flags.pip).toBe(false)
    expect(flags.cameraHud).toBe(false)
    expect(flags.navLegend).toBe(true)
    expect(flags.footer).toBe(false)
  })

  it('keeps the active lesson focused and reveals the object tray on demand', () => {
    const flags = editorChrome({
      playMode: false,
      workspaceMode: 'build',
      composeDock: 'timeline',
      showOutliner: false,
      showAddDrawer: false,
      tutorialActive: true,
    })
    expect(flags.addDrawer).toBe(false)
    expect(flags.directorDock).toBe(false)
    expect(flags.objectBar).toBe(true)

    const figureStep = editorChrome({
      playMode: false,
      workspaceMode: 'build',
      composeDock: 'timeline',
      showOutliner: false,
      showAddDrawer: true,
      tutorialActive: true,
    })
    expect(figureStep.addDrawer).toBe(true)
    expect(figureStep.directorDock).toBe(false)

    const poseStep = editorChrome({
      playMode: false,
      workspaceMode: 'build',
      composeDock: 'timeline',
      showOutliner: false,
      showAddDrawer: false,
      tutorialActive: true,
      tutorialInspectorVisible: true,
    })
    expect(poseStep.addDrawer).toBe(false)
    expect(poseStep.directorDock).toBe(true)
  })

  it('Compose shows the shot strip and the active-shot timeline together', () => {
    const flags = editorChrome({
      playMode: false,
      workspaceMode: 'compose',
      composeDock: 'sequence',
      showOutliner: false,
      showAddDrawer: false,
    })
    expect(flags.sequence).toBe(true)
    expect(flags.timeline).toBe(true)
    expect(flags.composeTabs).toBe(false)
    expect(flags.objectBar).toBe(true)
    expect(flags.shotFrame).toBe(false)
    expect(flags.directorDock).toBe(true)
    expect(flags.footer).toBe(true)
    expect(flags.navLegend).toBe(false)
  })

  it('Visualize keeps the Director dock and hides scene editing chrome', () => {
    const flags = editorChrome({
      playMode: false,
      workspaceMode: 'visualize',
      composeDock: 'sequence',
      showOutliner: true,
      showAddDrawer: true,
    })
    expect(flags.visualizeRail).toBe(true)
    expect(flags.directorDock).toBe(true)
    expect(flags.outliner).toBe(false)
    expect(flags.addDrawer).toBe(false)
    expect(flags.timeline).toBe(false)
    expect(flags.pip).toBe(false)
    expect(flags.cameraHud).toBe(false)
    expect(flags.onboarding).toBe(false)
    expect(isSceneEditing(false, 'visualize')).toBe(false)
    expect(isSceneEditing(false, 'build')).toBe(true)
    expect(isPathEditing(false, 'build')).toBe(false)
    expect(isPathEditing(false, 'compose')).toBe(true)
    expect(isPathStrokeTool('pen')).toBe(true)
    expect(isPathStrokeTool('draw')).toBe(true)
    expect(isPathStrokeTool('select')).toBe(false)
  })

  it('treats Visualize as a cinema viewport without playMode or look-through', () => {
    expect(isCinemaViewport(false, false, 'visualize')).toBe(true)
    expect(isCinemaViewport(false, false, 'compose')).toBe(false)
    expect(isCinemaViewport(false, false, 'build')).toBe(false)
    expect(isCinemaViewport(true, false, 'compose')).toBe(true)
    expect(isCinemaViewport(false, true, 'compose')).toBe(true)
  })

  it('hides path guides in Compose when the camera is Free (static)', () => {
    expect(pathGuidesVisible(false, 'compose', 'static')).toBe(false)
    expect(pathGuidesVisible(false, 'compose', 'path')).toBe(true)
    expect(pathGuidesVisible(false, 'build', 'static')).toBe(true)
    expect(pathGuidesVisible(false, 'visualize', 'path')).toBe(false)
  })
})

describe('editorChrome phone shell', () => {
  const base = {
    playMode: false,
    composeDock: 'timeline' as const,
    showOutliner: false,
    showAddDrawer: false,
  }

  it('replaces every docked rail with the phone shell on phone', () => {
    const chrome = editorChrome({ ...base, workspaceMode: 'build', tier: 'phone' })
    expect(chrome.phoneShell).toBe(true)
    // None of the persistent desktop chrome renders on phone.
    expect(chrome.directorDock).toBe(false)
    expect(chrome.outliner).toBe(false)
    expect(chrome.addDrawer).toBe(false)
    expect(chrome.toolbar).toBe(false)
    expect(chrome.footer).toBe(false)
    expect(chrome.timeline).toBe(false)
    expect(chrome.visualizeRail).toBe(false)
  })

  it('keeps the phone shell out of every docked tier', () => {
    for (const tier of ['tablet', 'compact', 'full'] as const) {
      const chrome = editorChrome({ ...base, workspaceMode: 'build', tier })
      expect(chrome.phoneShell).toBe(false)
      expect(chrome.directorDock).toBe(true)
    }
  })

  it('omits the phone shell when the tier is unspecified (desktop callers)', () => {
    const chrome = editorChrome({ ...base, workspaceMode: 'compose' })
    expect(chrome.phoneShell).toBe(false)
    expect(chrome.directorDock).toBe(true)
  })

  it('shows nothing at all in play mode, phone included', () => {
    const chrome = editorChrome({ ...base, workspaceMode: 'build', tier: 'phone', playMode: true })
    expect(chrome.phoneShell).toBe(false)
    expect(chrome.toolbar).toBe(false)
  })
})
