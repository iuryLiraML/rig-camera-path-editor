// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { CameraAdjustPanel } from './CameraAdjustPanel'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { DEFAULT_CAMERA_NOISE } from '../lib/cameraNoise'

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    cameraPanel: 'closed',
    workspaceMode: 'compose',
    playMode: false,
  })
  useRigStore.setState({ cameraNoise: { ...DEFAULT_CAMERA_NOISE } })
})

describe('CameraAdjustPanel', () => {
  it('stays hidden until the floating tab is open', () => {
    useEditorStore.setState({ cameraPanel: 'closed' })
    const { container } = render(<CameraAdjustPanel />)
    expect(container.textContent).toBe('')
  })

  it('shows lens and look-at on Adjust, not noise styles', () => {
    useEditorStore.setState({ cameraPanel: 'adjust' })
    const { container } = render(<CameraAdjustPanel />)
    expect(container.textContent).toContain('Camera')
    expect(container.textContent).toContain('Adjust')
    expect(container.textContent).toContain('FX')
    expect(container.textContent).toContain('FOV')
    expect(container.textContent).toContain('Look At')
    expect(container.textContent).not.toContain('Handheld')
  })

  it('shows shake / handheld / rumble on the FX tab', () => {
    useEditorStore.setState({ cameraPanel: 'fx' })
    const { container } = render(<CameraAdjustPanel />)
    expect(container.textContent).toContain('Shake')
    expect(container.textContent).toContain('Handheld')
    expect(container.textContent).toContain('Rumble')
    expect(container.textContent).not.toContain('Look At')
  })

  it('switches from Adjust to FX without leaving the floating tab', () => {
    useEditorStore.setState({ cameraPanel: 'adjust' })
    const { getByText } = render(<CameraAdjustPanel />)
    fireEvent.click(getByText('FX'))
    expect(useEditorStore.getState().cameraPanel).toBe('fx')
  })
})
