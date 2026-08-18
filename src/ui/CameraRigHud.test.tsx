// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { CameraRigHud } from './CameraRigHud'
import { ViewportFooter } from './ViewportFooter'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ selection: null, cameraView: false, playMode: false })
  useRigStore.setState({ cameraKind: 'path' })
})

describe('CameraRigHud', () => {
  it('stays hidden for a path camera', () => {
    useRigStore.setState({ cameraKind: 'path' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: false })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).toBe('')
  })

  it('offers Look through and Match view without overlapping footer copy', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'target' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: false })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).toContain('Look through')
    expect(container.textContent).toContain('Match view')
    expect(container.textContent).not.toContain('orange rings')
    expect(container.textContent).not.toContain('Move')
    expect(container.textContent).not.toContain('Rotate')
  })

  it('offers Show look-at when the aim handle is off', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'free' })
    useEditorStore.setState({ cameraView: false })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).toContain('Show look-at')
  })

  it('shows fly keys and right-drag look while looking through a free camera', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'free' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).toContain('Right-drag to look')
    expect(container.textContent).toContain('move')
    expect(container.textContent).toContain('W')
  })

  it('omits right-drag look when Target locks aim', () => {
    useRigStore.setState({ cameraKind: 'static', lookAtMode: 'target' })
    useEditorStore.setState({ selection: 'cinema-camera', cameraView: true })
    const { container } = render(<CameraRigHud />)
    expect(container.textContent).not.toContain('Right-drag to look')
    expect(container.textContent).toContain('Aim locked to look-at')
    expect(container.textContent).toContain('move')
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
})
