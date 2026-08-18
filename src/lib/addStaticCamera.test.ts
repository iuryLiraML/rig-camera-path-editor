import { afterEach, describe, expect, it } from 'vitest'
import { addStaticCamera, switchActiveCameraToStatic } from './addStaticCamera'
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
})
