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
    const { getByRole } = render(<TransformPopover objectId={objectId} />)
    expect(getByRole('button', { name: /position keyframe/i })).toBeTruthy()
    expect(getByRole('button', { name: /rotation keyframe/i })).toBeTruthy()
    expect(getByRole('button', { name: /scale keyframe/i })).toBeTruthy()
  })

  it('keys only position when the Position diamond is clicked', () => {
    const objectId = useSceneStore.getState().objects[0].id
    const { getByRole } = render(<TransformPopover objectId={objectId} />)
    fireEvent.click(getByRole('button', { name: /position keyframe/i }))
    const object = useSceneStore.getState().objects[0]
    expect(object.keys).toHaveLength(1)
    expect(object.keys[0].channel).toBe('position')
    expect(object.keys[0].time).toBeCloseTo(0.25, 5)
    expect(useEditorStore.getState().keyableFocus).toBe('objectPosition')
    expect(useEditorStore.getState().selectedKeyframe).toEqual({
      kind: 'object',
      objectId,
      id: object.keys[0].id,
    })
  })

  it('does not create rotation or scale keys from the Position diamond', () => {
    const objectId = useSceneStore.getState().objects[0].id
    const { getByRole } = render(<TransformPopover objectId={objectId} />)
    fireEvent.click(getByRole('button', { name: /position keyframe/i }))
    const channels = useSceneStore.getState().objects[0].keys.map((k) => k.channel)
    expect(channels).toEqual(['position'])
  })

  it('marks Transform as keyable so I keys all three when no row is focused', () => {
    const objectId = useSceneStore.getState().objects[0].id
    render(<TransformPopover objectId={objectId} />)
    expect(useEditorStore.getState().keyableFocus).toBe('object')
  })
})
