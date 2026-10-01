// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore } from '../../state/useSceneStore'
import { PhoneObjectAnimator } from './PhoneObjectAnimator'

beforeEach(() => {
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useEditorStore.setState({
    activeTaskPanel: 'none',
    selection: null,
    selectedKeyframe: null,
    keyableFocus: null,
  })
  useRigStore.setState({ t: 0.25, playing: false, duration: 6, fps: 30 })
})

afterEach(() => {
  cleanup()
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useEditorStore.setState({
    activeTaskPanel: 'none',
    selection: null,
    selectedKeyframe: null,
    keyableFocus: null,
  })
  useRigStore.setState({ t: 0, playing: false, duration: 6, fps: 30 })
})

describe('PhoneObjectAnimator', () => {
  it('routes an empty scene directly to Add objects', () => {
    const { getByRole } = render(<PhoneObjectAnimator />)

    fireEvent.click(getByRole('button', { name: 'Add an object' }))

    expect(useEditorStore.getState().activeTaskPanel).toBe('tools')
    expect(useEditorStore.getState().addDrawerChip).toBe('primitives')
  })

  it('adds object keys at the playhead and edits the selected key curve', () => {
    useSceneStore.getState().addPrimitive('box')
    const object = useSceneStore.getState().objects[0]
    useEditorStore.getState().select(`obj:${object.id}`)
    const { getByRole, getAllByRole } = render(<PhoneObjectAnimator />)

    const positionKey = () => getByRole('button', { name: /add a position keyframe at the playhead/i })
    fireEvent.click(positionKey())
    fireEvent.change(getByRole('slider', { name: 'Animation playhead' }), { target: { value: '0.75' } })
    fireEvent.click(positionKey())

    const keys = useSceneStore.getState().objects[0].keys
    expect(keys).toHaveLength(2)
    expect(keys.map((key) => key.time)).toEqual([0.25, 0.75])
    expect(keys.every((key) => key.channel === 'position')).toBe(true)

    fireEvent.click(getByRole('button', { name: /Position.*1\.50s/ }))
    fireEvent.change(getByRole('combobox', { name: 'Curve preset' }), {
      target: { value: 'cubicOut' },
    })
    expect(useSceneStore.getState().objects[0].keys.find((key) => key.id === keys[0].id)?.ease).toBe('cubicOut')

    const handle = getByRole('slider', { name: 'First handle time' })
    fireEvent.change(handle, { target: { value: '0.3' } })
    expect(useSceneStore.getState().objects[0].keys.find((key) => key.id === keys[0].id)?.easeBezier?.[0]).toBe(0.3)
    expect(getAllByRole('img', { name: 'Animation curve preview' })).toHaveLength(1)
  })
})
