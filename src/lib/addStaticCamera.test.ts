import { afterEach, describe, expect, it } from 'vitest'
import { addStaticCamera, detachCinemaToStatic, switchActiveCameraToStatic } from './addStaticCamera'
import { makeEmptyRigSnapshot, useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'

afterEach(() => {
  useCameraOptionsStore.setState({
    options: [{ id: 'camera-default', name: 'Camera 1', rig: makeEmptyRigSnapshot() }],
    activeOptionId: 'camera-default',
  })
  useRigStore.setState({ cameraKind: 'path', lookAtMode: 'target' })
  useEditorStore.setState({ cameraView: false, selection: null, tool: 'select' })
})

describe('addStaticCamera', () => {
  it('starts a new free camera in Free look-at', () => {
    addStaticCamera()
    expect(useRigStore.getState().cameraKind).toBe('static')
    expect(useRigStore.getState().lookAtMode).toBe('free')
  })
})

describe('switchActiveCameraToStatic', () => {
  it('keeps Target if the path camera already had it', () => {
    useRigStore.setState({ lookAtMode: 'target', cameraKind: 'path' })
    switchActiveCameraToStatic()
    expect(useRigStore.getState().cameraKind).toBe('static')
    expect(useRigStore.getState().lookAtMode).toBe('target')
  })

  it('stays Free instead of forcing Target from the path-tangent', () => {
    useRigStore.setState({ lookAtMode: 'free', cameraKind: 'path' })
    switchActiveCameraToStatic()
    expect(useRigStore.getState().lookAtMode).toBe('free')
  })

  it('does not force Target when detaching a path-tangent camera', () => {
    useRigStore.setState({ lookAtMode: 'path-tangent', cameraKind: 'path' })
    switchActiveCameraToStatic()
    expect(useRigStore.getState().lookAtMode).toBe('free')
  })

  it('exits look-through so the body can be posed in the editor', () => {
    useRigStore.setState({ cameraKind: 'path' })
    useEditorStore.setState({ cameraView: true, selection: 'cinema-camera' })
    switchActiveCameraToStatic()
    expect(useEditorStore.getState().cameraView).toBe(false)
  })
})

describe('detachCinemaToStatic', () => {
  it('keeps look-through open when stayInView is set', () => {
    useRigStore.setState({ cameraKind: 'path', lookAtMode: 'path-tangent' })
    useEditorStore.setState({ cameraView: true, selection: 'cinema-camera' })
    detachCinemaToStatic({ stayInView: true })
    expect(useRigStore.getState().cameraKind).toBe('static')
    expect(useRigStore.getState().lookAtMode).toBe('free')
    expect(useEditorStore.getState().cameraView).toBe(true)
    expect(useEditorStore.getState().selection).toBe('cinema-camera')
  })

  it('is a no-op when the camera is already static', () => {
    const pose = { position: [1, 2, 3] as [number, number, number], rotation: [10, 20, 0] as [number, number, number] }
    useRigStore.setState({ cameraKind: 'static', staticPose: pose, lookAtMode: 'free' })
    detachCinemaToStatic({ stayInView: true })
    expect(useRigStore.getState().staticPose.position).toEqual([1, 2, 3])
    expect(useRigStore.getState().cameraKind).toBe('static')
  })
})
