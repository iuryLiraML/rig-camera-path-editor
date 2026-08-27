import * as THREE from 'three'

type SplatTreeLike = {
  subTrees?: Array<{
    sceneMin?: THREE.Vector3
    sceneMax?: THREE.Vector3
    rootNode?: { boundingBox?: THREE.Box3 }
  }>
}

type SplatMeshLike = THREE.Object3D & {
  getSplatTree?: () => unknown
  onSplatTreeReady?: (cb: () => void) => void
}

export function splatPickBounds(splatMesh: SplatMeshLike): THREE.Box3 | null {
  const tree = splatMesh.getSplatTree?.() as SplatTreeLike | null | undefined
  const sub = tree?.subTrees?.[0]
  if (sub?.sceneMin && sub.sceneMax) {
    const box = new THREE.Box3(sub.sceneMin.clone(), sub.sceneMax.clone())
    if (!box.isEmpty()) return box
  }
  if (sub?.rootNode?.boundingBox && !sub.rootNode.boundingBox.isEmpty()) {
    return sub.rootNode.boundingBox.clone()
  }
  return new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))
}

/** Invisible AABB so the palco is pickable. Clay objects still win on the same ray. */
export function attachEnvironmentPickProxy(splatMesh: SplatMeshLike): THREE.Mesh {
  const existing = splatMesh.getObjectByName('environment-pick')
  if (existing instanceof THREE.Mesh) return existing

  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ visible: false }),
  )
  proxy.name = 'environment-pick'
  proxy.userData.pickKind = 'env'
  proxy.userData.pickId = 'env'
  splatMesh.add(proxy)
  const layout = () => layoutPickProxy(proxy, splatMesh)
  layout()
  splatMesh.onSplatTreeReady?.(layout)
  return proxy
}

function layoutPickProxy(proxy: THREE.Mesh, splatMesh: SplatMeshLike) {
  const box = splatPickBounds(splatMesh)
  if (!box) return
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  proxy.geometry.dispose()
  proxy.geometry = new THREE.BoxGeometry(
    Math.max(0.35, size.x),
    Math.max(0.35, size.y),
    Math.max(0.35, size.z),
  )
  proxy.position.copy(center)
  proxy.raycast = THREE.Mesh.prototype.raycast
}
