import * as THREE from 'three'
import type { ViewMode } from '../state/useEditorStore'
import type { SceneObject } from '../state/useSceneStore'

export type AssetDisplayMode = 'solid' | 'wireframe'
export type AssetDisplayContext = 'live' | 'export'
export type MeshMaterial = THREE.Material | THREE.Material[]
export type SourceMaterialMap = Map<THREE.Mesh, MeshMaterial>
export type AssetDisplayResources = {
  material: THREE.MeshStandardMaterial
  sourceMaterials: SourceMaterialMap
  wireframeMaterial: THREE.MeshStandardMaterial
}

export function shadeToHex(shade: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(shade) ? shade : 0))
  return `#${new THREE.Color().setScalar(clamped).getHexString()}`
}

export function normalizeHexColor(value: string, fallback = '#ffffff'): string {
  const raw = value.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`
  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw.split('').map((digit) => digit.repeat(2)).join('')}`
  }
  const normalizedFallback = fallback.trim().replace(/^#/, '').toLowerCase()
  return /^[0-9a-f]{6}$/.test(normalizedFallback) ? `#${normalizedFallback}` : '#ffffff'
}

export function captureSourceMaterials(root: THREE.Object3D): SourceMaterialMap {
  const materials: SourceMaterialMap = new Map()
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) materials.set(child, child.material)
  })
  return materials
}

export function hasMeshGeometry(root: THREE.Object3D): boolean {
  let found = false
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) found = true
  })
  return found
}

export function makeWireframeMaterial(clayColor: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: clayColor,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
    wireframe: true,
  })
}

export function createAssetDisplayResources(
  root: THREE.Object3D,
  shade: number,
  clayColor = shadeToHex(shade),
): AssetDisplayResources {
  const color = normalizeHexColor(clayColor, shadeToHex(shade))
  return {
    material: new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    sourceMaterials: captureSourceMaterials(root),
    wireframeMaterial: makeWireframeMaterial(color),
  }
}

export function disposeAssetDisplayResources(
  resources: Pick<AssetDisplayResources, 'material' | 'wireframeMaterial'>,
): void {
  resources.material.dispose()
  resources.wireframeMaterial.dispose()
}

function assignMaterial(root: THREE.Object3D, material: MeshMaterial) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.material = material
    child.castShadow = true
    child.receiveShadow = true
  })
}

function assignSourceMaterials(object: SceneObject) {
  object.root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.material = object.sourceMaterials.get(child) ?? object.material
    child.castShadow = true
    child.receiveShadow = true
  })
}

/**
 * The one boundary that arbitrates authored, clay, and inspection materials.
 * Technical passes stay solid underneath their scene-wide override material.
 */
export function applyAssetDisplay(
  object: SceneObject,
  viewMode: ViewMode,
  context: AssetDisplayContext = 'live',
) {
  if (viewMode !== 'look' && viewMode !== 'clay') {
    assignMaterial(object.root, object.material)
    return
  }
  const sourceTopologyVisible = object.root.userData.rigRemeshPlaceholder !== true
  if (context === 'live' && object.displayMode === 'wireframe' && sourceTopologyVisible) {
    assignMaterial(object.root, object.wireframeMaterial)
    return
  }
  if (viewMode === 'look') {
    assignSourceMaterials(object)
    return
  }
  assignMaterial(object.root, object.material)
}

export function sourceMaterialsForClone(object: SceneObject, clone: THREE.Object3D): void {
  const sourceMeshes: THREE.Mesh[] = []
  const cloneMeshes: THREE.Mesh[] = []
  object.root.traverse((child) => {
    if (child instanceof THREE.Mesh) sourceMeshes.push(child)
  })
  clone.traverse((child) => {
    if (child instanceof THREE.Mesh) cloneMeshes.push(child)
  })
  cloneMeshes.forEach((mesh, index) => {
    const source = sourceMeshes[index]
    if (source) mesh.material = object.sourceMaterials.get(source) ?? object.material
  })
}
