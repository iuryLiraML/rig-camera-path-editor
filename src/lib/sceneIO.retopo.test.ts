import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { makeObject, useSceneStore } from '../state/useSceneStore'
import { countTriangles, objectNeedsRetopo, RETOPO_TRIANGLES, undoLastMeshRevision, clearMeshRevisionsForTests, pushMeshRevisionForTests } from './sceneIO'
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
