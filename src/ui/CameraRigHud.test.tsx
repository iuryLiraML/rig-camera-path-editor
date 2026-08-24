// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { CameraRigHud } from './CameraRigHud'
import { ViewportFooter } from './ViewportFooter'
import { DEFAULT_COMPOSITION_GUIDES } from '../lib/compositionGuides'
import { useEditorStore } from '../state/useEditorStore'
import { CAMERA_PATH_ID, makeAnchor, usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import { emptyVec3AxisKeyState } from '../lib/vec3Axes'

function seedPathCamera() {
  usePathStore.setState({
    paths: [
      {
        id: CAMERA_PATH_ID,
        name: 'Camera Path',
        anchors: [makeAnchor([0, 1, 0]), makeAnchor([4, 1, -2])],
        closed: false,
        rounding: 0.8,
      },
    ],
    activePathId: CAMERA_PATH_ID,
  })
  useRigStore.setState({ cameraKind: 'path', cameraPathId: CAMERA_PATH_ID })
}

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    selection: null,
    cameraView: false,
    playMode: false,
    workspaceMode: 'compose',
    flyRecording: false,
    lookThroughLivePose: false,
    compositionGuides: { ...DEFAULT_COMPOSITION_GUIDES },
    cameraPanel: 'closed',
  })
  useRigStore.setState({
    cameraKind: 'path',
    lookAtMode: 'target',
    t: 0,
    fovKeys: [],
    rollKeys: [],
    progressKeys: [],
    ...emptyVec3AxisKeyState(),
  })
  usePathStore.setState({
    paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
  })
})

describe('CameraRigHud', () => {
  it('stays hidden for a path camera with no path yet', () => {
    useRigStore.setState({ cameraKind: 'path' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: false })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).toBe('')
  })

  it('stays hidden in the editor — Look through lives on the footer', () => {
    seedPathCamera()
    useEditorStore.setState({
      selection: 'cinema-camera',
      cameraView: false,
      workspaceMode: 'compose',
    })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).toBe('')
    expect(container.querySelector('[data-testid="camera-rig-hud"]')).toBeNull()
  })

  it('shows fly hints, pose buttons, and an Exit camera button', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'free' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).toContain('Looking through')
    expect(container.textContent).toContain('Drag to look')
    expect(container.textContent).toContain('fly')
    expect(container.textContent).toContain('WASD')
    expect(container.textContent).toContain('Add pose')
    expect(container.textContent).toContain('Remove pose')
    expect(container.textContent).toContain('Record fly')
    expect(container.textContent).toContain('Exit camera')
    expect(container.textContent).toContain('Camera settings')
    expect(container.textContent).toContain('Roll')
    expect(container.querySelector('[data-testid="look-through-roll"]')).toBeTruthy()
    expect(container.textContent).toContain('Thirds')
    expect(container.textContent).toContain('Safe')
    expect(container.querySelector('[data-testid="composition-guides"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="film-gate"]')).toBeTruthy()
    expect(container.textContent).not.toContain('Esc exits')
  })

  it('says aim is locked until the user drags to look', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'target' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).not.toContain('Drag to look')
    expect(container.textContent).toContain('Aim locked')
    expect(container.textContent).toContain('fly')
  })

  it('offers the same fly + pose controls on a path camera', () => {
    seedPathCamera()
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).toContain('Looking through')
    expect(container.textContent).toContain('fly')
    expect(container.textContent).toContain('Add pose')
    expect(container.textContent).toContain('Exit camera')
    expect(container.textContent).not.toContain('FOV')
    expect(container.querySelector('[data-testid="look-through-frame"]')).toBeTruthy()
    expect(
      container.querySelector('[data-testid="look-through-frame"]')?.getAttribute('data-recording'),
    ).toBe('false')
  })

  it('Add pose keys the playhead and stays in look-through', () => {
    seedPathCamera()
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true })
    const { getByTitle } = render(<CameraRigHud />)
    fireEvent.click(getByTitle('Set a pose keyframe at the playhead (I)'))
    expect(useRigStore.getState().cameraKind).toBe('static')
    expect(useRigStore.getState().staticPosXKeys.length).toBeGreaterThan(0)
    expect(useEditorStore.getState().cameraView).toBe(true)
  })

  it('does not mark look-through as recording just because a camera track exists', () => {
    seedPathCamera()
    useRigStore.getState().upsertChannelKey('fov', 0, 45)
    useEditorStore.setState({ cameraView: true })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).not.toContain('REC')
    expect(
      container.querySelector('[data-testid="look-through-frame"]')?.getAttribute('data-recording'),
    ).toBe('false')
  })

  it('marks the look-through frame as recording during a fly take', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'free' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true, flyRecording: true })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).toContain('REC')
    expect(container.textContent).toContain('Stop record')
    expect(
      container.querySelector('[data-testid="look-through-frame"]')?.getAttribute('data-recording'),
    ).toBe('true')
  })

  it('Record fly starts a drone take', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'free' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true })
    const { getByTitle } = render(<CameraRigHud />)
    fireEvent.click(getByTitle('Fly the camera like a drone and key the take as time plays'))
    expect(useEditorStore.getState().flyRecording).toBe(true)
    expect(useRigStore.getState().staticPosXKeys.length).toBeGreaterThan(0)
  })

  it('guide chips toggle the on-lens overlay', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'free' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true })
    const { getByTitle } = render(<CameraRigHud />)
    expect(useEditorStore.getState().compositionGuides.golden).toBe(false)
    fireEvent.click(getByTitle('Show golden guide'))
    expect(useEditorStore.getState().compositionGuides.golden).toBe(true)
    fireEvent.click(getByTitle('Hide thirds guide'))
    expect(useEditorStore.getState().compositionGuides.thirds).toBe(false)
  })

  it('exits look-through from the center Exit camera button', () => {
    seedPathCamera()
    useEditorStore.setState({ cameraView: true })
    const { getByTitle } = render(<CameraRigHud />)
    fireEvent.click(getByTitle('Back to the editor camera (Esc)'))
    expect(useEditorStore.getState().cameraView).toBe(false)
  })

  it('opens camera adjustments from look-through', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'free' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true, cameraPanel: 'closed' })
    const { getByTitle } = render(<CameraRigHud />)
    fireEvent.click(getByTitle('Camera settings'))
    expect(useEditorStore.getState().cameraPanel).toBe('adjust')
    fireEvent.click(getByTitle('Camera settings'))
    expect(useEditorStore.getState().cameraPanel).toBe('closed')
  })

  it('writes roll from the look-through slider', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'free', roll: 0 })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true })
    const { getByLabelText } = render(<CameraRigHud />)
    fireEvent.change(getByLabelText('Roll'), { target: { value: '12' } })
    expect(useRigStore.getState().roll).toBe(12)
    fireEvent.keyDown(getByLabelText('Roll wheel'), { key: 'ArrowRight' })
    expect(useRigStore.getState().roll).toBe(13)
  })
})

describe('ViewportFooter', () => {
  it('hides Clay / Depth / Outline while looking through', () => {
    useEditorStore.setState({ cameraView: true })
    const { container } = render(<ViewportFooter />)
    expect(container.textContent).toBe('')
  })

  it('shows Clay in the editor', () => {
    useEditorStore.setState({ cameraView: false })
    const { container } = render(<ViewportFooter />)
    expect(container.textContent).toContain('Clay')
  })

  it('offers Look through on a ready path camera', () => {
    seedPathCamera()
    useEditorStore.setState({
      selection: 'cinema-camera',
      cameraView: false,
      workspaceMode: 'compose',
    })
    const { container } = render(<ViewportFooter />)
    expect(container.textContent).toContain('Look through')
    expect(container.textContent).not.toContain('Match view')
  })

  it('offers Look through and Match view on a static camera', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'target' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: false })
    const { container } = render(<ViewportFooter />)
    expect(container.textContent).toContain('Look through')
    expect(container.textContent).toContain('Match view')
    expect(container.textContent).not.toContain('orange rings')
    expect(container.textContent).not.toContain('Move')
    expect(container.textContent).not.toContain('Rotate')
  })

  it('offers Show look-at when the aim handle is off', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'free' })
    useEditorStore.setState({ cameraView: false })
    const { container } = render(<ViewportFooter />)
    expect(container.textContent).toContain('Show look-at')
  })
})
