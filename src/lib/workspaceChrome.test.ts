import { describe, expect, it } from 'vitest'
import { editorChrome, isPathEditing, isSceneEditing } from './workspaceChrome'

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
      showAddDrawer: true,
    })
    expect(flags.addDrawer).toBe(true)
    expect(flags.objectBar).toBe(true)
    expect(flags.timeline).toBe(false)
    expect(flags.visualizeRail).toBe(false)
    expect(flags.directorDock).toBe(true)
    expect(flags.pip).toBe(false)
    expect(flags.cameraHud).toBe(false)
  })

  it('Compose Sequence is not the AE timeline', () => {
    const flags = editorChrome({
      playMode: false,
      workspaceMode: 'compose',
      composeDock: 'sequence',
      showOutliner: false,
      showAddDrawer: false,
    })
    expect(flags.sequence).toBe(true)
    expect(flags.timeline).toBe(false)
    expect(flags.shotFrame).toBe(true)
    expect(flags.directorDock).toBe(true)
  })

  it('Visualize keeps the floating Director dock, not a right rail', () => {
    const flags = editorChrome({
      playMode: false,
      workspaceMode: 'visualize',
      composeDock: 'sequence',
      showOutliner: true,
      showAddDrawer: true,
    })
    expect(flags.visualizeRail).toBe(false)
    expect(flags.directorDock).toBe(true)
    expect(flags.outliner).toBe(false)
    expect(flags.addDrawer).toBe(false)
    expect(isSceneEditing(false, 'visualize')).toBe(false)
    expect(isSceneEditing(false, 'build')).toBe(true)
    expect(isPathEditing(false, 'build')).toBe(false)
    expect(isPathEditing(false, 'compose')).toBe(true)
  })
})
