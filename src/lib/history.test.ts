import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { VIEWPORT_BG_DEFAULT_TOP } from '../viewport/viewportBackground'
import { addDummyToScene, setDummyBoneAxis } from './dummyCharacter'
import { makeObject, useSceneStore } from '../state/useSceneStore'
import { useEditorStore } from '../state/useEditorStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { IDENTITY_ENV_TRANSFORM } from './environment'
import {
  historyClock,
  historyIsDirty,
  resetHistory,
  setHistoryClockForTests,
  setHistorySuspended,
  undo,
} from './history'

afterEach(() => {
  useSceneStore.setState({ bgColor: VIEWPORT_BG_DEFAULT_TOP, objects: [] })
  useEditorStore.setState({ selection: null })
  useEnvironmentStore.setState({
    environmentId: null,
    environmentTransform: IDENTITY_ENV_TRANSFORM,
    sceneBindings: [],
  })
  resetHistory()
  setHistoryClockForTests(0)
})

describe('history vs remesh undo', () => {
  it('treats an uncommitted transform as dirty so Ctrl+Z undoes the move first', () => {
    resetHistory()
    expect(historyIsDirty()).toBe(false)
    expect(historyClock()).toBe(0)
    const before = useSceneStore.getState().bgColor
    useSceneStore.setState({ bgColor: '#111111' })
    expect(historyIsDirty()).toBe(true)
    expect(undo()).toBe(true)
    expect(useSceneStore.getState().bgColor).toBe(before)
    expect(historyClock()).toBe(0)
  })
})

describe('history vs environment pose', () => {
  it('undoes a palco move', () => {
    resetHistory()
    useEnvironmentStore.setState({
      environmentId: 'beach',
      environmentTransform: {
        position: [2, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    })
    expect(historyIsDirty()).toBe(true)
    expect(undo()).toBe(true)
    expect(useEnvironmentStore.getState().environmentTransform.position).toEqual([0, 0, 0])
    expect(useEnvironmentStore.getState().environmentId).toBeNull()
  })
})

describe('history vs dummy FK', () => {
  it('undoes a stored bone pose', () => {
    const id = addDummyToScene()
    resetHistory()
    setDummyBoneAxis(id, 'LeftArm', 2, 40)
    expect(useSceneStore.getState().objects.find((item) => item.id === id)?.bonePose?.LeftArm?.[2]).toBe(40)
    expect(undo()).toBe(true)
    expect(useSceneStore.getState().objects.find((item) => item.id === id)?.bonePose).toBeUndefined()
  })
})

describe('history vs per-object clay color', () => {
  it('restores the authored clay color and both display materials', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    const object = makeObject('Car', root, {
      id: 'car',
      shade: 0.5,
      clayColor: '#2563eb',
    })
    useSceneStore.setState({ objects: [object] })
    resetHistory()

    useSceneStore.getState().setObjectColor('car', '#dc2626')
    expect(undo()).toBe(true)

    const restored = useSceneStore.getState().objects[0]!
    expect(restored.clayColor).toBe('#2563eb')
    expect(`#${restored.material.color.getHexString()}`).toBe('#2563eb')
    expect(`#${restored.wireframeMaterial.color.getHexString()}`).toBe('#2563eb')
  })
})

describe('history suspend', () => {
  it('groups edits into one undo step', () => {
    resetHistory()
    const before = useSceneStore.getState().bgColor
    setHistorySuspended(true)
    useSceneStore.setState({ bgColor: '#111111' })
    useSceneStore.setState({ bgColor: '#222222' })
    setHistorySuspended(false)
    expect(useSceneStore.getState().bgColor).toBe('#222222')
    expect(undo()).toBe(true)
    expect(useSceneStore.getState().bgColor).toBe(before)
  })
})
