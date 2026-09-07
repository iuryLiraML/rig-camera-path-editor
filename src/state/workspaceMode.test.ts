import { describe, expect, it } from 'vitest'
import { isOrbitLocked, lockOrbit, resetOrbitLock } from '../lib/orbitLock'
import { useEditorStore } from '../state/useEditorStore'
import { usePathStore } from './usePathStore'
import { useSceneStore } from '../state/useSceneStore'

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

  it('drops the draw tool when leaving Compose', () => {
    useEditorStore.setState({ workspaceMode: 'compose', tool: 'draw' })
    useEditorStore.getState().setWorkspaceMode('build')
    expect(useEditorStore.getState().tool).toBe('select')
  })

  it('clears a leaked orbit lock when leaving Draw or changing workspace', () => {
    resetOrbitLock()
    useEditorStore.setState({ workspaceMode: 'compose', tool: 'draw' })
    lockOrbit()
    expect(isOrbitLocked()).toBe(true)
    useEditorStore.getState().setTool('select')
    expect(isOrbitLocked()).toBe(false)

    lockOrbit()
    useEditorStore.getState().setWorkspaceMode('build')
    expect(isOrbitLocked()).toBe(false)
  })

  it('snaps Top + ortho when Draw is activated', () => {
    useEditorStore.setState({
      workspaceMode: 'compose',
      tool: 'select',
      projection: 'perspective',
      viewRequest: null,
    })
    useEditorStore.getState().setTool('draw')
    const editor = useEditorStore.getState()
    expect(editor.tool).toBe('draw')
    expect(editor.projection).toBe('orthographic')
    expect(editor.viewRequest?.view).toBe('top')
  })

  it('starts a new Pen path in Top and preserves its editing view after finishing', () => {
    usePathStore.getState().clearPath()
    useEditorStore.setState({
      workspaceMode: 'compose',
      tool: 'select',
      projection: 'perspective',
      viewRequest: null,
      viewPoseRestore: null,
    })
    useEditorStore.getState().setTool('pen')
    expect(useEditorStore.getState().projection).toBe('orthographic')
    expect(useEditorStore.getState().viewRequest?.view).toBe('top')
    expect(useEditorStore.getState().viewPoseRestore).toBeNull()
    useEditorStore.getState().setTool('select')
    expect(useEditorStore.getState().projection).toBe('orthographic')
  })

  it('preserves the current view when reentering Pen on an existing curve', () => {
    usePathStore.getState().setPath([[0, 0, 0], [3, 2, 1]], false)
    useEditorStore.setState({ tool: 'select', projection: 'perspective', viewRequest: { view: 'front', n: 8 }, viewPoseRestore: null })
    useEditorStore.getState().setTool('pen')
    expect(useEditorStore.getState().projection).toBe('perspective')
    expect(useEditorStore.getState().viewRequest).toEqual({ view: 'front', n: 8 })
    usePathStore.getState().clearPath()
  })

  it('exits look-through when a stroke tool is activated', () => {
    useEditorStore.setState({
      workspaceMode: 'compose',
      tool: 'select',
      cameraView: true,
      flyRecording: true,
      lookThroughLivePose: true,
    })
    useEditorStore.getState().setTool('pen')
    const editor = useEditorStore.getState()
    expect(editor.cameraView).toBe(false)
    expect(editor.flyRecording).toBe(false)
    expect(editor.lookThroughLivePose).toBe(false)
  })

  it('leaves a technical pass for Clay and says so when a stroke tool is activated', () => {
    useEditorStore.setState({ workspaceMode: 'compose', tool: 'select', viewMode: 'depth' })
    useSceneStore.setState({ notice: null })
    useEditorStore.getState().setTool('pen')
    expect(useEditorStore.getState().viewMode).toBe('clay')
    expect(useSceneStore.getState().notice).toContain('Clay')
  })

  it('keeps Look and stays quiet when a stroke tool is activated', () => {
    useEditorStore.setState({ workspaceMode: 'compose', tool: 'select', viewMode: 'look' })
    useSceneStore.setState({ notice: null })
    useEditorStore.getState().setTool('pen')
    expect(useEditorStore.getState().viewMode).toBe('look')
    expect(useSceneStore.getState().notice).toBeNull()
  })

  /**
   * The reverse of the two cases above, and the one that survived the fix:
   * the Pen mounts only in a shaded, non-look-through Compose, so arriving at
   * either from an armed Pen left the button lit over a tool that could not
   * place. Clicking Look-through on the camera preview mid-draw was enough.
   */
  it('disarms a stroke tool when entering look-through', () => {
    useEditorStore.setState({ workspaceMode: 'compose', tool: 'pen', cameraView: false })
    useEditorStore.getState().setCameraView(true)
    expect(useEditorStore.getState().tool).toBe('select')
  })

  it('disarms a stroke tool when a technical pass is picked', () => {
    useEditorStore.setState({ workspaceMode: 'compose', tool: 'draw', viewMode: 'clay' })
    useEditorStore.getState().setViewMode('depth')
    expect(useEditorStore.getState().tool).toBe('select')
  })

  /** The MP4 export cycles every pass and restores; it must not pocket the tool. */
  it('keeps the Pen armed while the recorder cycles passes', () => {
    useEditorStore.setState({
      workspaceMode: 'compose',
      tool: 'pen',
      viewMode: 'clay',
      recording: true,
    })
    useEditorStore.getState().setViewMode('outline')
    expect(useEditorStore.getState().tool).toBe('pen')
    useEditorStore.setState({ recording: false })
  })

  it('keeps the Pen armed for shaded passes and on leaving look-through', () => {
    useEditorStore.setState({ workspaceMode: 'compose', tool: 'pen', viewMode: 'clay' })
    useEditorStore.getState().setViewMode('look')
    expect(useEditorStore.getState().tool).toBe('pen')
    useEditorStore.getState().setCameraView(false)
    expect(useEditorStore.getState().tool).toBe('pen')
  })

  it('closes the camera inspector when leaving Compose', () => {
    useEditorStore.setState({ workspaceMode: 'compose', cameraPanel: 'fx' })
    useEditorStore.getState().setWorkspaceMode('build')
    expect(useEditorStore.getState().cameraPanel).toBe('closed')
  })

  it('exits look-through when leaving Compose', () => {
    useEditorStore.setState({
      workspaceMode: 'compose',
      cameraView: true,
      flyRecording: true,
      lookThroughLivePose: true,
    })
    useEditorStore.getState().setWorkspaceMode('build')
    const editor = useEditorStore.getState()
    expect(editor.cameraView).toBe(false)
    expect(editor.flyRecording).toBe(false)
    expect(editor.lookThroughLivePose).toBe(false)
  })

  it('keeps the Transform panel when moving Build → Compose', () => {
    useEditorStore.setState({
      workspaceMode: 'build',
      objectBarPanel: 'transform',
      selection: 'obj:box-1',
    })
    useEditorStore.getState().setWorkspaceMode('compose')
    expect(useEditorStore.getState().objectBarPanel).toBe('transform')
  })

  it('does not overlay Transform on the viewport when W/E/R is used on a selected object', () => {
    useEditorStore.setState({
      selection: 'obj:box-1',
      objectBarPanel: 'none',
      gizmoMode: 'translate',
    })
    useEditorStore.getState().setGizmoMode('rotate')
    expect(useEditorStore.getState().objectBarPanel).toBe('none')
    expect(useEditorStore.getState().gizmoMode).toBe('rotate')
  })

  it('does not overlay Transform on the viewport when W/E/R is used on the environment palco', () => {
    useEditorStore.setState({
      selection: 'env',
      objectBarPanel: 'none',
      gizmoMode: 'translate',
    })
    useEditorStore.getState().setGizmoMode('translate')
    expect(useEditorStore.getState().objectBarPanel).toBe('none')
  })

  it('opens the camera inspector when a cinema camera is picked in Compose', () => {
    useEditorStore.setState({ workspaceMode: 'compose', cameraPanel: 'closed' })
    useEditorStore.getState().select('cinema-camera')
    expect(useEditorStore.getState().cameraPanel).toBe('adjust')
  })
})
