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
  redo,
  beginHistoryTransaction,
} from './history'
import { CAMERA_PATH_ID, makeAnchor, usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import { writeStaticPose } from './autoKey'

describe('camera pose history', () => {
  it('undoes and redoes a Free camera gesture without animation keys', () => {
    useRigStore.setState({
      cameraKind: 'static',
      staticPose: { position: [1, 2, 3], rotation: [0, 0, 0] },
      staticPosXKeys: [], staticPosYKeys: [], staticPosZKeys: [],
      staticRotXKeys: [], staticRotYKeys: [], staticRotZKeys: [],
    })
    resetHistory()
    writeStaticPose({ position: [9, 8, 7], rotation: [0.1, 0.2, 0.3] })
    expect(historyIsDirty()).toBe(true)
    expect(undo()).toBe(true)
    expect(useRigStore.getState().staticPose).toEqual({ position: [1, 2, 3], rotation: [0, 0, 0] })
    expect(redo()).toBe(true)
    expect(useRigStore.getState().staticPose).toEqual({ position: [9, 8, 7], rotation: [0.1, 0.2, 0.3] })
  })
})

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
  it('cancels a handle gesture without consuming the preceding undo step', () => {
    usePathStore.getState().setPath([[0, 0, 0], [3, 0, 0]], false)
    resetHistory()
    const path = usePathStore.getState()
    const id = path.getPath(path.activePathId)!.anchors[0].id
    path.setHandle(id, 'out', [1, 2, 3], true)
    const finish = beginHistoryTransaction()
    path.setHandle(id, 'out', [4, 5, 6], true)
    finish(true)
    expect(path.getPath(path.activePathId)!.anchors[0].handleOut).toEqual([1, 2, 3])
    expect(undo()).toBe(true)
    expect(path.getPath(path.activePathId)!.anchors[0].manual).toBe(false)
    expect(redo()).toBe(true)
    expect(path.getPath(path.activePathId)!.anchors[0].handleOut).toEqual([1, 2, 3])
  })
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

describe('history vs path anchors', () => {
  it('restores deleted anchors on the same path', () => {
    const a = makeAnchor([0, 1, 0])
    const b = makeAnchor([2, 1, 0])
    usePathStore.setState({
      paths: [
        {
          id: CAMERA_PATH_ID,
          name: 'Camera Path',
          closed: false,
          rounding: 0.8,
          anchors: [a, b],
        },
      ],
      activePathId: CAMERA_PATH_ID,
      selectedAnchorRefs: [],
      primaryAnchorRef: null,
      selectedAnchorId: null,
      selectedAnchorIds: [],
    })
    resetHistory()
    usePathStore.getState().removeAnchors([a.id, b.id])
    expect(usePathStore.getState().paths[0]?.anchors).toEqual([])
    expect(undo()).toBe(true)
    const path = usePathStore.getState().paths.find((item) => item.id === CAMERA_PATH_ID)
    expect(path?.anchors.map((anchor) => anchor.id)).toEqual([a.id, b.id])
  })
})
