// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { CameraBar } from './CameraBar'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'

beforeEach(() => {
  useRigStore.setState({
    t: 0.4,
    fov: 45,
    fovKeys: [],
    ease: 'linear',
  })
  useEditorStore.setState({ keyableFocus: null, selection: null, cameraPanel: 'closed' })
})

afterEach(() => {
  cleanup()
  useEditorStore.setState({ keyableFocus: null, selection: null, cameraPanel: 'closed' })
  useRigStore.setState({ fovKeys: [], fov: 45 })
})

describe('CameraBar', () => {
  it('puts a FOV keyframe diamond next to the lens', () => {
    const { getByRole, getByTitle } = render(<CameraBar embedded />)
    expect(getByTitle('Lens').textContent).toMatch(/mm/)
    expect(getByRole('button', { name: /FOV keyframe/i })).toBeTruthy()
  })

  it('keys FOV at the playhead from the diamond', () => {
    const { getByRole } = render(<CameraBar embedded />)
    fireEvent.click(getByRole('button', { name: /FOV keyframe/i }))
    const keys = useRigStore.getState().fovKeys
    expect(keys).toHaveLength(1)
    expect(keys[0].time).toBeCloseTo(0.4, 5)
    expect(keys[0].value).toBeCloseTo(45)
    expect(useEditorStore.getState().keyableFocus).toBe('fov')
    expect(useEditorStore.getState().selection).toBe('cinema-camera')
  })

  it('auto-keys a lens preset only after FOV already has a track', () => {
    const { getByTitle, getByText } = render(<CameraBar embedded />)
    fireEvent.click(getByTitle('Lens'))
    fireEvent.click(getByText('70mm Portrait'))
    expect(useRigStore.getState().fovKeys).toHaveLength(0)
    expect(useRigStore.getState().fov).toBeLessThan(45)

    useRigStore.getState().upsertChannelKey('fov', 0, 45)
    fireEvent.click(getByTitle('Lens'))
    fireEvent.click(getByText('24mm Wide'))
    expect(useRigStore.getState().fovKeys.length).toBeGreaterThanOrEqual(2)
  })
})
