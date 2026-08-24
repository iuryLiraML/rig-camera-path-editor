import { describe, expect, it } from 'vitest'
import { editorChrome, isCinemaViewport, isPathEditing, isSceneEditing } from './workspaceChrome'

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
  })

  it('treats Visualize as a cinema viewport without playMode or look-through', () => {
    expect(isCinemaViewport(false, false, 'visualize')).toBe(true)
    expect(isCinemaViewport(false, false, 'compose')).toBe(false)
    expect(isCinemaViewport(false, false, 'build')).toBe(false)
    expect(isCinemaViewport(true, false, 'compose')).toBe(true)
    expect(isCinemaViewport(false, true, 'compose')).toBe(true)
  })
})
