import { beforeEach, describe, expect, it } from 'vitest'
import { CAMERA_PATH_ID, usePathStore } from './usePathStore'
import { useRigStore } from './useRigStore'
import { cameraAnchorCount, cameraPath, pathsUsedByCameras } from './cameraPathLink'
import { useCameraOptionsStore } from './useCameraOptionsStore'

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

beforeEach(() => {
  usePathStore.setState({
    paths: [
      { id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 },
    ],
    activePathId: CAMERA_PATH_ID,
  })
  useRigStore.setState({ cameraPathId: CAMERA_PATH_ID })
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
