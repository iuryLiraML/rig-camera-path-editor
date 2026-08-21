// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'
import { TransformPopover } from './TransformPopover'

beforeEach(() => {
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useRigStore.setState({ t: 0.25 })
  useEditorStore.setState({
    keyableFocus: null,
    objectBarPanel: 'transform',
    selectedKeyframe: null,
  })
  useSceneStore.getState().addPrimitive('box')
})

afterEach(() => {
  cleanup()
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useEditorStore.setState({
    keyableFocus: null,
    objectBarPanel: 'none',
    selectedKeyframe: null,
    selection: null,
  })
})

describe('TransformPopover', () => {
  it('puts a keyframe diamond on Position, Rotation and Scale', () => {
    const objectId = useSceneStore.getState().objects[0].id
    const { getAllByRole } = render(<TransformPopover objectId={objectId} />)
    const diamonds = getAllByRole('button', { name: /pose keyframe/i })
    expect(diamonds).toHaveLength(3)
  })

  it('adds a pose key at the playhead when a diamond is clicked', () => {
    const objectId = useSceneStore.getState().objects[0].id
    const { getAllByRole } = render(<TransformPopover objectId={objectId} />)
    fireEvent.click(getAllByRole('button', { name: /pose keyframe/i })[0])
    const object = useSceneStore.getState().objects[0]
    expect(object.keys).toHaveLength(1)
    expect(object.keys[0].time).toBeCloseTo(0.25, 5)
    expect(useEditorStore.getState().selectedKeyframe).toEqual({
      kind: 'object',
      objectId,
      id: object.keys[0].id,
    })
  })

  it('marks Transform as keyable so I / Delete target the pose', () => {
    const objectId = useSceneStore.getState().objects[0].id
    render(<TransformPopover objectId={objectId} />)
    expect(useEditorStore.getState().keyableFocus).toBe('object')
  })
})
