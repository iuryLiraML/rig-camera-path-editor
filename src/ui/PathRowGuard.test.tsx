// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LeftPanel } from './LeftPanel'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { useEditorStore } from '../state/useEditorStore'
import { makeEmptyRigSnapshot } from '../state/useCameraOptionsStore'
import { makeDefaultKnotObject, useSceneStore } from '../state/useSceneStore'

/**
 * Paths had no remove control in the outliner at all, and the camera's control
 * disappeared entirely when only one camera existed — which reads as "this cannot
 * be deleted" rather than "not this one".
 *
 * The guard that matters: a path a camera still follows must refuse deletion.
 * Without it the camera silently falls back to the camera path and the move is
 * gone with no message — the same class of silent loss that cost a camera earlier
 * in this project.
 */

const cameraOn = (name: string, pathId: string) => ({
  id: `cam-${name}`,
  name,
  rig: { ...makeEmptyRigSnapshot(), pathId },
})

const deleteButtonFor = (container: HTMLElement, label: string) => {
  const row = Array.from(container.querySelectorAll('div.group')).find((el) =>
    el.textContent?.trim().startsWith(label),
  )
  if (!row) return null
  return (
    Array.from(row.querySelectorAll('button')).find((b) =>
      /Delete path|In use by|last path/.test(b.title),
    ) ?? null
  )
}

beforeEach(() => {
  useEditorStore.setState({ playMode: false, selection: null })
  usePathStore.setState({
    paths: [
      { id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 },
      { id: 'road', name: 'Road', anchors: [], closed: false, rounding: 0.8 },
    ],
    activePathId: CAMERA_PATH_ID,
  })
})

afterEach(cleanup)

describe('path row remove control', () => {
  it('offers deletion for a path no camera follows', () => {
    useCameraOptionsStore.setState({
      options: [cameraOn('Wide', CAMERA_PATH_ID)],
      activeOptionId: 'cam-Wide',
    })
    const { container } = render(<LeftPanel />)
    const button = deleteButtonFor(container, 'Road')
    expect(button).not.toBeNull()
    expect(button!.disabled).toBe(false)
    expect(button!.title).toBe('Delete path')
  })

  it('refuses, with the cameras named, when a camera follows it', () => {
    useCameraOptionsStore.setState({
      options: [cameraOn('Wide', 'road'), cameraOn('Tight', 'road')],
      activeOptionId: 'cam-Wide',
    })
    const { container } = render(<LeftPanel />)
    const button = deleteButtonFor(container, 'Road')
    expect(button!.disabled).toBe(true)
    expect(button!.title).toContain('Wide')
    expect(button!.title).toContain('Tight')
    expect(button!.title).toContain('those cameras')
  })

  it('says "that camera" for a single follower', () => {
    useCameraOptionsStore.setState({
      options: [cameraOn('Wide', 'road')],
      activeOptionId: 'cam-Wide',
    })
    const { container } = render(<LeftPanel />)
    expect(deleteButtonFor(container, 'Road')!.title).toContain('that camera')
  })

  it('protects the last remaining path', () => {
    usePathStore.setState({
      paths: [
        { id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 },
      ],
      activePathId: CAMERA_PATH_ID,
    })
    useCameraOptionsStore.setState({ options: [], activeOptionId: '' })
    const { container } = render(<LeftPanel />)
    const button = deleteButtonFor(container, 'Camera Path')
    expect(button!.disabled).toBe(true)
    expect(button!.title).toContain('last path')
  })
})

describe('camera row remove control', () => {
  it('stays visible but disabled when only one camera exists', () => {
    useCameraOptionsStore.setState({
      options: [cameraOn('Wide', CAMERA_PATH_ID)],
      activeOptionId: 'cam-Wide',
    })
    const { container } = render(<LeftPanel />)
    const row = Array.from(container.querySelectorAll('div.group')).find((el) =>
      el.textContent?.trim().startsWith('Wide'),
    )!
    const button = Array.from(row.querySelectorAll('button')).find((b) =>
      /camera/i.test(b.title),
    )!
    // it used to be absent, which looked like "cameras cannot be deleted"
    expect(button.disabled).toBe(true)
    expect(button.title).toContain('last camera')
  })
})

describe('scene object remove control', () => {
  it('shows a trash control on the torus knot row', () => {
    const knot = makeDefaultKnotObject({ id: 'obj-knot' })
    knot.name = 'Torus Knot'
    useSceneStore.setState({ objects: [knot] })
    useCameraOptionsStore.setState({
      options: [cameraOn('Wide', CAMERA_PATH_ID)],
      activeOptionId: 'cam-Wide',
    })
    const { container } = render(<LeftPanel />)
    const row = Array.from(container.querySelectorAll('div.group')).find((el) =>
      el.textContent?.includes('Torus Knot'),
    )
    expect(row).toBeTruthy()
    const button = Array.from(row!.querySelectorAll('button')).find((b) =>
      b.title === 'Delete object',
    )
    expect(button).toBeTruthy()
    expect(button!.disabled).toBe(false)
  })
})
