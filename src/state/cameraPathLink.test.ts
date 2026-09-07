import { beforeEach, describe, expect, it } from 'vitest'
import { CAMERA_PATH_ID, usePathStore } from './usePathStore'
import { useRigStore } from './useRigStore'
import {
  cameraAnchorCount,
  cameraPath,
  followedPathSnapshot,
  pathsUsedByCameras,
  activateFollowedPath,
  activateEditPath,
  applySelectPointerIntent,
  followActivePathIfFree,
} from './cameraPathLink'
import { useCameraOptionsStore } from './useCameraOptionsStore'
import { useEditorStore } from './useEditorStore'
import { selectPointerIntent } from '../lib/viewportPick'
import * as THREE from 'three'

/**
 * The camera follows a path *by reference* now (approved: shared reference — two
 * cameras on one path both move when it is edited).
 *
 * Before this, `useRigStore.cameraPathId` existed and nothing read it: the cinema
 * camera resolved the hard-coded `CAMERA_PATH_ID`, and every camera option
 * carried its own inline copy of the geometry, so switching cameras *overwrote*
 * the single path slot. These tests pin the reference behaviour, especially the
 * parts that used to be impossible: pointing a camera at another path, and not
 * silently destroying a path that a camera still follows.
 */

const anchorsFor = (id: string) => usePathStore.getState().getPath(id)?.anchors.length ?? 0

function baseRig() {
  return {
    anchors: [],
    closed: false,
    drawPlaneY: 1.2,
    duration: 6,
    smoothness: 0.6,
    rounding: 0.8,
    loop: true,
    lookAtMode: 'target' as const,
    target: [0, 1, 0] as [number, number, number],
    roll: 0,
    fov: 45,
    progressKeys: [],
  }
}

beforeEach(() => {
  usePathStore.setState({
    paths: [
      { id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 },
    ],
    activePathId: CAMERA_PATH_ID,
  })
  useRigStore.setState({ cameraPathId: CAMERA_PATH_ID, cameraKind: 'path' })
  useCameraOptionsStore.setState({
    options: [
      {
        id: 'camera-default',
        name: 'Camera 1',
        rig: { ...baseRig(), pathId: CAMERA_PATH_ID },
        pristine: true,
      },
    ],
    activeOptionId: 'camera-default',
  })
})

describe('cameraPath', () => {
  it('resolves the path the active camera follows, not a fixed id', () => {
    const road = usePathStore.getState().createPath('Road')
    useRigStore.getState().setCameraPath(road)
    expect(cameraPath()?.id).toBe(road)
    expect(cameraPath()?.name).toBe('Road')
  })

  it('falls back to the camera path when the reference dangles', () => {
    // a project saved against a path that no longer exists must still open
    useRigStore.setState({ cameraPathId: 'deleted-path' })
    expect(cameraPath()?.id).toBe(CAMERA_PATH_ID)
  })

  it('counts anchors of the followed path', () => {
    const road = usePathStore.getState().createPath('Road')
    usePathStore.getState().setActivePath(road)
    usePathStore.getState().setPath(
      [
        [0, 1, 0],
        [1, 1, 0],
        [2, 1, 0],
      ],
      false,
    )
    expect(cameraAnchorCount()).toBe(0) // still following the empty camera path
    useRigStore.getState().setCameraPath(road)
    expect(cameraAnchorCount()).toBe(3)
  })
})

describe('followedPathSnapshot', () => {
  it('bundles the camera-followed path geometry for a Shot, not the unused camera-path slot', () => {
    const road = usePathStore.getState().createPath('Road')
    usePathStore.getState().setActivePath(road)
    usePathStore.getState().setPath(
      [
        [0, 1, 0],
        [4, 1, 0],
      ],
      false,
    )
    usePathStore.getState().setRounding(0.4)
    useRigStore.getState().setCameraPath(road)
    const snap = followedPathSnapshot()
    expect(snap.pathId).toBe(road)
    expect(snap.anchors).toHaveLength(2)
    expect(snap.closed).toBe(false)
    expect(snap.rounding).toBe(0.4)
    expect(usePathStore.getState().getPath(CAMERA_PATH_ID)?.anchors).toHaveLength(0)
  })

  it('falls back to the camera path when the follow dangles', () => {
    useRigStore.setState({ cameraPathId: 'deleted-path' })
    expect(followedPathSnapshot().pathId).toBe(CAMERA_PATH_ID)
  })
})

describe('setCameraPath', () => {
  it('repoints instead of overwriting geometry', () => {
    const road = usePathStore.getState().createPath('Road')
    usePathStore.getState().setActivePath(road)
    usePathStore.getState().setPath([[0, 1, 0], [5, 1, 0]], false)
    const before = anchorsFor(road)

    useRigStore.getState().setCameraPath(road)

    // the old model copied the camera's snapshot over the path slot; the point of
    // a reference is that nothing is written
    expect(anchorsFor(road)).toBe(before)
    expect(anchorsFor(CAMERA_PATH_ID)).toBe(0)
  })

  it('ignores an unknown path id rather than dangling the camera', () => {
    useRigStore.getState().setCameraPath('nope')
    expect(useRigStore.getState().cameraPathId).toBe(CAMERA_PATH_ID)
  })
})

describe('pathsUsedByCameras', () => {
  it('reports which cameras follow each path, so sharing is visible', () => {
    const road = usePathStore.getState().createPath('Road')
    useCameraOptionsStore.setState({
      options: [
        { id: 'cam-a', name: 'Wide', rig: { ...baseRig(), pathId: road } },
        { id: 'cam-b', name: 'Tight', rig: { ...baseRig(), pathId: road } },
        { id: 'cam-c', name: 'Top', rig: { ...baseRig(), pathId: CAMERA_PATH_ID } },
      ],
      activeOptionId: 'cam-a',
    })

    const used = pathsUsedByCameras()
    expect(used.get(road)).toEqual(['Wide', 'Tight'])
    expect(used.get(CAMERA_PATH_ID)).toEqual(['Top'])
  })

  it('is empty when no camera names a path', () => {
    useCameraOptionsStore.setState({ options: [], activeOptionId: '' })
    expect(pathsUsedByCameras().size).toBe(0)
  })
})

describe('activateEditPath', () => {
  it('selects a path for editing without retargeting the active camera', () => {
    const road = usePathStore.getState().createPath('Road')
    const detour = usePathStore.getState().createPath('Detour')
    useRigStore.setState({ cameraKind: 'path', cameraPathId: road })
    usePathStore.getState().setActivePath(road)
    activateEditPath(detour)
    expect(usePathStore.getState().activePathId).toBe(detour)
    expect(useRigStore.getState().cameraPathId).toBe(road)
    expect(useRigStore.getState().cameraKind).toBe('path')
    expect(useCameraOptionsStore.getState().options[0]?.rig.pathId).toBe(CAMERA_PATH_ID)
  })

  it('ignores unknown ids', () => {
    activateEditPath('missing')
    expect(usePathStore.getState().activePathId).toBe(CAMERA_PATH_ID)
    expect(useRigStore.getState().cameraPathId).toBe(CAMERA_PATH_ID)
  })

  it('additive click adds a path without retargeting the followed camera', () => {
    const road = usePathStore.getState().createPath('Road')
    const detour = usePathStore.getState().createPath('Detour')
    useRigStore.setState({ cameraKind: 'path', cameraPathId: road })
    useEditorStore.setState({ selection: null, selectionIds: [] })
    activateEditPath(road)
    activateEditPath(detour, true)
    expect(useEditorStore.getState().selectionIds).toEqual([`path:${road}`, `path:${detour}`])
    expect(usePathStore.getState().activePathId).toBe(detour)
    expect(useRigStore.getState().cameraPathId).toBe(road)
  })

  it('additive click removes a selected path without retargeting the followed camera', () => {
    const road = usePathStore.getState().createPath('Road')
    const detour = usePathStore.getState().createPath('Detour')
    useRigStore.setState({ cameraKind: 'path', cameraPathId: road })
    useEditorStore.setState({ selection: null, selectionIds: [] })
    activateEditPath(road)
    activateEditPath(detour, true)
    activateEditPath(detour, true)
    expect(useEditorStore.getState().selectionIds).toEqual([`path:${road}`])
    expect(usePathStore.getState().activePathId).toBe(road)
    expect(useRigStore.getState().cameraPathId).toBe(road)
  })

  it('plain click still replaces the selection without retargeting the followed camera', () => {
    const road = usePathStore.getState().createPath('Road')
    const detour = usePathStore.getState().createPath('Detour')
    useRigStore.setState({ cameraKind: 'path', cameraPathId: road })
    useEditorStore.setState({ selection: 'obj:first', selectionIds: ['obj:first'] })
    activateEditPath(detour)
    expect(useEditorStore.getState().selectionIds).toEqual([`path:${detour}`])
    expect(usePathStore.getState().activePathId).toBe(detour)
    expect(useRigStore.getState().cameraPathId).toBe(road)
  })

  it('additive click keeps existing object members', () => {
    const detour = usePathStore.getState().createPath('Detour')
    useRigStore.setState({ cameraKind: 'path', cameraPathId: CAMERA_PATH_ID })
    useEditorStore.setState({ selection: 'obj:first', selectionIds: ['obj:first'] })
    activateEditPath(detour, true)
    expect(useEditorStore.getState().selectionIds).toEqual(['obj:first', `path:${detour}`])
    expect(usePathStore.getState().activePathId).toBe(detour)
    expect(useRigStore.getState().cameraPathId).toBe(CAMERA_PATH_ID)
  })
})

describe('applySelectPointerIntent', () => {
  it('activates the path under the cursor without changing follow', () => {
    const road = usePathStore.getState().createPath('Road')
    const detour = usePathStore.getState().createPath('Detour')
    useRigStore.setState({ cameraKind: 'path', cameraPathId: road })
    usePathStore.getState().setActivePath(road)

    const env = new THREE.Object3D()
    env.userData = { pickKind: 'env', pickId: 'env' }
    const line = new THREE.Object3D()
    line.userData = { pickKind: 'path-line', pickId: `path:${detour}` }
    const intent = selectPointerIntent([
      { object: env, distance: 1 },
      { object: line, distance: 1.02 },
    ])
    applySelectPointerIntent(intent)

    expect(intent).toEqual({ action: 'select-path', id: `path:${detour}` })
    expect(usePathStore.getState().activePathId).toBe(detour)
    expect(useRigStore.getState().cameraPathId).toBe(road)
  })
})

describe('activateFollowedPath', () => {
  it('sets the active path and the camera follow together', () => {
    const road = usePathStore.getState().createPath('Road')
    useRigStore.setState({ cameraKind: 'static', cameraPathId: CAMERA_PATH_ID })
    activateFollowedPath(road)
    expect(usePathStore.getState().activePathId).toBe(road)
    expect(useRigStore.getState().cameraPathId).toBe(road)
    expect(useRigStore.getState().cameraKind).toBe('path')
    expect(useCameraOptionsStore.getState().options[0]?.rig.pathId).toBe(road)
  })

  it('ignores unknown ids', () => {
    useRigStore.setState({ cameraPathId: CAMERA_PATH_ID, cameraKind: 'path' })
    activateFollowedPath('missing')
    expect(usePathStore.getState().activePathId).toBe(CAMERA_PATH_ID)
    expect(useRigStore.getState().cameraPathId).toBe(CAMERA_PATH_ID)
  })
})

describe('followActivePathIfFree', () => {
  it('binds a Free camera to the path the pen is editing', () => {
    const road = usePathStore.getState().createPath('Road')
    usePathStore.getState().setActivePath(road)
    useRigStore.setState({ cameraKind: 'static', cameraPathId: CAMERA_PATH_ID })
    followActivePathIfFree()
    expect(useRigStore.getState().cameraKind).toBe('path')
    expect(useRigStore.getState().cameraPathId).toBe(road)
  })

  it('does not retarget a camera that already follows a path', () => {
    const road = usePathStore.getState().createPath('Road')
    const detour = usePathStore.getState().createPath('Detour')
    usePathStore.getState().setActivePath(detour)
    useRigStore.setState({ cameraKind: 'path', cameraPathId: road })
    followActivePathIfFree()
    expect(useRigStore.getState().cameraPathId).toBe(road)
    expect(usePathStore.getState().activePathId).toBe(detour)
  })
})
