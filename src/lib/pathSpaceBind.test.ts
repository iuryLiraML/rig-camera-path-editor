import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import { identityTransform } from '../state/useSceneStore'
import { setCameraPathSpace, setTrackObjectId } from './pathSpaceBind'
import type { ObjectMotion } from './objectMotion'

const car: { id: string } & ObjectMotion = {
  id: 'car',
  transform: { ...identityTransform, position: [10, 0, 0] },
  keys: [],
}

beforeEach(() => {
  useRigStore.setState({
    targetObjectId: 'car',
    pathSpace: 'world',
    t: 0,
    ease: 'linear',
    cameraPathId: CAMERA_PATH_ID,
  })
  usePathStore.setState({
    paths: [
      {
        id: CAMERA_PATH_ID,
        name: 'Camera Path',
        anchors: [
          {
            id: 'a',
            position: [10, 1, 2],
            handleIn: [0, 0, 0],
            handleOut: [0, 0, 0],
            mirrored: true,
            manual: false,
          },
          {
            id: 'b',
            position: [12, 1, 2],
            handleIn: [0, 0, 0],
            handleOut: [0, 0, 0],
            mirrored: true,
            manual: false,
          },
        ],
        closed: false,
        rounding: 0,
      },
    ],
    activePathId: CAMERA_PATH_ID,
  })
})

describe('setCameraPathSpace', () => {
  it('bakes world anchors into the parent local frame and back', () => {
    const scene = { objects: [car], paths: usePathStore.getState().paths }
    setCameraPathSpace('object', scene)
    expect(useRigStore.getState().pathSpace).toBe('object')
    const local = usePathStore.getState().getPath(CAMERA_PATH_ID)!.anchors[0].position
    expect(local[0]).toBeCloseTo(0, 4)
    expect(local[2]).toBeCloseTo(2, 4)

    setCameraPathSpace('world', scene)
    expect(useRigStore.getState().pathSpace).toBe('world')
    const world = usePathStore.getState().getPath(CAMERA_PATH_ID)!.anchors[0].position
    expect(world[0]).toBeCloseTo(10, 4)
    expect(world[2]).toBeCloseTo(2, 4)
  })
})

describe('setTrackObjectId', () => {
  it('sets AABB center on a new attach and preserves offset on the same id', () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1))
    mesh.position.set(0, 1, 0)
    root.add(mesh)
    const person: { id: string; root: THREE.Object3D } & ObjectMotion = {
      id: 'person',
      root,
      transform: { ...identityTransform },
      keys: [],
    }
    const scene = { objects: [person], paths: usePathStore.getState().paths }

    useRigStore.setState({
      targetObjectId: null,
      lookOffset: [0, 0, 0],
      lookOffsetKeys: [],
    })
    setTrackObjectId('person', scene)
    expect(useRigStore.getState().targetObjectId).toBe('person')
    expect(useRigStore.getState().lookOffset[1]).toBeCloseTo(1, 3)

    useRigStore.getState().setLookOffset([0, 1.6, 0])
    setTrackObjectId('person', scene)
    expect(useRigStore.getState().lookOffset[1]).toBeCloseTo(1.6, 5)
  })

  it('zeros offset when clearing the track', () => {
    useRigStore.setState({
      targetObjectId: 'car',
      lookOffset: [0, 1.6, 0],
      lookOffsetKeys: [{ id: 'k', time: 0, value: [0, 1.6, 0] }],
    })
    setTrackObjectId(null, { objects: [car], paths: usePathStore.getState().paths })
    expect(useRigStore.getState().targetObjectId).toBeNull()
    expect(useRigStore.getState().lookOffset).toEqual([0, 0, 0])
    expect(useRigStore.getState().lookOffsetKeys).toEqual([])
  })
})
