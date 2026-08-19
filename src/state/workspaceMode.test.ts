import { describe, expect, it } from 'vitest'
import { useEditorStore } from '../state/useEditorStore'

describe('workspaceMode', () => {
  it('sends Board to Compose Sequence instead of a separate view', () => {
    useEditorStore.setState({
      appView: 'editor',
      workspaceMode: 'build',
      composeDock: 'timeline',
    })
    useEditorStore.getState().setAppView('board')
    expect(useEditorStore.getState().appView).toBe('editor')
    expect(useEditorStore.getState().workspaceMode).toBe('compose')
    expect(useEditorStore.getState().composeDock).toBe('sequence')
  })

  it('closes the outliner when leaving Build', () => {
    useEditorStore.setState({
      workspaceMode: 'build',
      showOutliner: true,
    })
    useEditorStore.getState().setWorkspaceMode('compose')
    expect(useEditorStore.getState().showOutliner).toBe(false)
  })

  it('drops the pen tool when leaving Compose', () => {
    useEditorStore.setState({ workspaceMode: 'compose', tool: 'pen' })
    useEditorStore.getState().setWorkspaceMode('build')
    expect(useEditorStore.getState().tool).toBe('select')
  })

  it('closes the camera inspector when leaving Compose', () => {
    useEditorStore.setState({ workspaceMode: 'compose', cameraPanel: 'fx' })
    useEditorStore.getState().setWorkspaceMode('build')
    expect(useEditorStore.getState().cameraPanel).toBe('closed')
  })

  it('opens the camera inspector when a cinema camera is picked in Compose', () => {
    useEditorStore.setState({ workspaceMode: 'compose', cameraPanel: 'closed' })
    useEditorStore.getState().select('cinema-camera')
    expect(useEditorStore.getState().cameraPanel).toBe('adjust')
  })
})
