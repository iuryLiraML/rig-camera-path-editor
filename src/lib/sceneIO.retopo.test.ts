import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { makeObject, useSceneStore } from '../state/useSceneStore'
import {
  countTriangles,
  objectNeedsRetopo,
  RETOPO_TRIANGLES,
  FAL_REMESH_MAX_BYTES,
  undoLastMeshRevision,
  clearMeshRevisionsForTests,
  pushMeshRevisionForTests,
  denseImportDecision,
  denseRemeshStartCopy,
  denseRemeshNeedsKeyCopy,
  remeshTooLargeCopy,
  formatTriangleCount,
} from './sceneIO'
import { setHistoryClockForTests } from './history'

function meshWithTriangles(count: number) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(count * 3), 1))
  const root = new THREE.Group()
  root.add(new THREE.Mesh(geometry))
  return root
}

afterEach(() => {
  useSceneStore.setState({ objects: [] })
  clearMeshRevisionsForTests()
  setHistoryClockForTests(0)
})

describe('retopo thresholds', () => {
  it('counts indexed triangles', () => {
    expect(countTriangles(meshWithTriangles(12))).toBe(12)
  })

  it('flags imported meshes above 80k', () => {
    const light = makeObject('Light', meshWithTriangles(100), { id: 'light', bufferKey: 'light' })
    const heavy = makeObject('Heavy', meshWithTriangles(RETOPO_TRIANGLES + 1), {
      id: 'heavy',
      bufferKey: 'heavy',
    })
    const primitive = makeObject('Box', meshWithTriangles(RETOPO_TRIANGLES + 1), {
      id: 'prim',
      bufferKey: null,
    })
    useSceneStore.setState({ objects: [light, heavy, primitive] })
    expect(objectNeedsRetopo('light')).toBe(false)
    expect(objectNeedsRetopo('heavy')).toBe(true)
    expect(objectNeedsRetopo('prim')).toBe(false)
  })

  it('does not steal Ctrl+Z when the remeshed object is gone, unselected, or history is newer', () => {
    pushMeshRevisionForTests('missing', new ArrayBuffer(8))
    expect(undoLastMeshRevision(null)).toBe(false)
    expect(undoLastMeshRevision('missing')).toBe(false)
    pushMeshRevisionForTests('car', new ArrayBuffer(8), 0)
    setHistoryClockForTests(2)
    expect(undoLastMeshRevision('car')).toBe(false)
  })
})

describe('auto-remesh import decision', () => {
  it('formats triangle counts the way the notices do', () => {
    expect(formatTriangleCount(240_000)).toBe('240k triangles')
    expect(formatTriangleCount(90_000)).toBe('90k triangles')
    expect(formatTriangleCount(2_000_000)).toBe('2.0M triangles')
  })

  it('auto-sends dense meshes when Fal is ready', () => {
    expect(denseImportDecision('Car', 240_000, 12_000, true)).toEqual({
      action: 'remesh',
      notice: denseRemeshStartCopy('Car', 240_000),
    })
    expect(denseRemeshStartCopy('Car', 240_000)).toBe(
      '"Car" is dense (240k triangles). Remeshing with Tripo…',
    )
  })

  it('skips the viewport when there is no Fal key', () => {
    expect(denseImportDecision('Car', 240_000, 12_000, false)).toEqual({
      action: 'skip',
      notice: denseRemeshNeedsKeyCopy('Car', 240_000),
    })
    expect(denseRemeshNeedsKeyCopy('Car', 240_000)).toBe(
      '"Car" is dense (240k triangles). Add a Fal key in Settings to remesh.',
    )
  })

  it('refuses files over the Fal 150 MB cap', () => {
    expect(denseImportDecision('Car', 240_000, FAL_REMESH_MAX_BYTES + 1, true)).toEqual({
      action: 'skip',
      notice: remeshTooLargeCopy('Car'),
    })
    expect(remeshTooLargeCopy('Car')).toBe('"Car" is too large to remesh (max 150 MB).')
  })

  it('imports clay-friendly meshes without remesh', () => {
    expect(denseImportDecision('Car', RETOPO_TRIANGLES, FAL_REMESH_MAX_BYTES + 1, false)).toEqual({
      action: 'import',
    })
  })
})
