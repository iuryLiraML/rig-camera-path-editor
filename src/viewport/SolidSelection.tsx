import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { SceneObject } from '../state/useSceneStore'
import { useSolidSelectionStore } from '../state/useSolidSelectionStore'
import { primitiveMesh } from '../lib/solidEditing'
import { primitiveTopology, resolveCadFace } from '../lib/primitiveGeometry'

const noPick = () => {}
export function selectSolidSurface(object: SceneObject, mesh: THREE.Mesh, faceIndex: number, worldPoint: THREE.Vector3) {
  const { mode } = useSolidSelectionStore.getState()
  const topology = primitiveTopology(mesh.geometry)
  if (mode === 'face') {
    const face = topology.faces[topology.triangleFaces[faceIndex]]
    useSolidSelectionStore.setState({ selection: face ? { objectId: object.id, face: face.ref } : null })
  } else if (mode === 'edge') {
    const point = mesh.worldToLocal(worldPoint.clone())
    let edge: number | undefined, nearest = Infinity
    topology.edges.forEach(([a, b], i) => {
      const distance = new THREE.Line3(new THREE.Vector3(...a), new THREE.Vector3(...b)).closestPointToPoint(point, true, new THREE.Vector3()).distanceToSquared(point)
      if (distance < nearest) { nearest = distance; edge = i }
    })
    useSolidSelectionStore.setState({ selection: edge == null ? null : { objectId: object.id, edge } })
  }
}

export function SolidSelection({ object }: { object: SceneObject }) {
  const { selection, mode } = useSolidSelectionStore()
  const mesh = primitiveMesh(object)
  const overlay = useMemo(() => {
    if (selection?.objectId !== object.id || mode === 'body') return null
    const geometry = new THREE.BufferGeometry()
    if (selection.face && mode === 'face') {
      try {
        const face = resolveCadFace(mesh.geometry, selection.face)
        const values = face.triangles.flatMap((tri) => [0, 1, 2].flatMap((i) => new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), mesh.geometry.index!.getX(tri * 3 + i)).toArray()))
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3))
        return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
      } catch { geometry.dispose(); return null }
    }
    const edge = selection.edge == null ? null : primitiveTopology(mesh.geometry).edges[selection.edge]
    if (!edge) { geometry.dispose(); return null }
    geometry.setFromPoints(edge.map((v) => new THREE.Vector3(...v)))
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }))
  }, [selection, mode, object.id, mesh.geometry])
  useEffect(() => () => { overlay?.geometry.dispose(); overlay?.material.dispose() }, [overlay])
  return overlay ? <primitive object={overlay} position-y={mesh.position.y} raycast={noPick} /> : null
}
