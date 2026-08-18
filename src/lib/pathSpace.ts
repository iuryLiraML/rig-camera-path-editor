import * as THREE from 'three'
import type { PathAnchor } from '../state/usePathStore'
import type { Transform, Vec3 } from '../state/useSceneStore'

export type PathSpace = 'world' | 'object'

const DEG = Math.PI / 180
const _m = new THREE.Matrix4()
const _inv = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _e = new THREE.Euler()

/** Parent TRS → matrix. Euler is XYZ degrees, same as SceneObjects. */
export function matrixFromTransform(transform: Transform, out = _m): THREE.Matrix4 {
  _p.set(...transform.position)
  _e.set(transform.rotation[0] * DEG, transform.rotation[1] * DEG, transform.rotation[2] * DEG, 'XYZ')
  _q.setFromEuler(_e)
  _s.set(...transform.scale)
  return out.compose(_p, _q, _s)
}

export function localPointToWorld(local: Vec3, parent: Transform): Vec3 {
  const m = matrixFromTransform(parent)
  _p.set(...local).applyMatrix4(m)
  return [_p.x, _p.y, _p.z]
}

export function worldPointToLocal(world: Vec3, parent: Transform): Vec3 {
  _inv.copy(matrixFromTransform(parent)).invert()
  _p.set(...world).applyMatrix4(_inv)
  return [_p.x, _p.y, _p.z]
}

/** Direction / handle offset — linear part only, no translation. */
export function localDirToWorld(local: Vec3, parent: Transform): Vec3 {
  const origin = localPointToWorld([0, 0, 0], parent)
  const tip = localPointToWorld(local, parent)
  return [tip[0] - origin[0], tip[1] - origin[1], tip[2] - origin[2]]
}

export function worldDirToLocal(world: Vec3, parent: Transform): Vec3 {
  const origin = localPointToWorld([0, 0, 0], parent)
  return worldPointToLocal([origin[0] + world[0], origin[1] + world[1], origin[2] + world[2]], parent)
}

export function bakeAnchorsToSpace(
  anchors: PathAnchor[],
  parent: Transform,
  direction: 'worldToLocal' | 'localToWorld',
): PathAnchor[] {
  const point = direction === 'worldToLocal' ? worldPointToLocal : localPointToWorld
  const dir = direction === 'worldToLocal' ? worldDirToLocal : localDirToWorld
  return anchors.map((anchor) => ({
    ...anchor,
    position: point(anchor.position, parent),
    handleIn: dir(anchor.handleIn, parent),
    handleOut: dir(anchor.handleOut, parent),
  }))
}
