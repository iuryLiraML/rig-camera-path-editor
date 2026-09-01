import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { makeObject, makePrimitive, useSceneStore } from '../state/useSceneStore'
import { objectFromDenseMeta, toMeta } from './sceneIO'
import { applyAssetDisplay, normalizeHexColor, shadeToHex } from './assetDisplay'
import { makeDummyObject } from './dummyCharacter'

function importedRoot(material: THREE.Material) {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material))
  return root
}

function firstMesh(root: THREE.Object3D) {
  let mesh: THREE.Mesh | undefined
  root.traverse((child) => {
    if (!mesh && child instanceof THREE.Mesh) mesh = child
  })
  return mesh!
}

afterEach(() => {
  useSceneStore.setState({ objects: [], pendingLifts: [] })
})

describe('per-asset display arbitration', () => {
  it('derives default clay colors from shade and normalizes authored hex values', () => {
    const object = makeObject('Default', importedRoot(new THREE.MeshStandardMaterial()), {
      shade: 0.5,
    })

    expect(shadeToHex(0.5)).toBe('#bcbcbc')
    expect(normalizeHexColor('#AbC123')).toBe('#abc123')
    expect(normalizeHexColor('abc')).toBe('#aabbcc')
    expect(object.clayColor).toBe('#bcbcbc')
    expect(`#${object.material.color.getHexString()}`).toBe('#bcbcbc')
    expect(`#${object.wireframeMaterial.color.getHexString()}`).toBe('#bcbcbc')
  })

  it('updates Solid and Wireframe together, while Shade resets both to gray', () => {
    const object = makeObject('Car', importedRoot(new THREE.MeshStandardMaterial()), {
      id: 'car',
      shade: 0.5,
    })
    useSceneStore.setState({ objects: [object] })

    useSceneStore.getState().setObjectColor('car', '#D14A72')
    const colored = useSceneStore.getState().objects[0]!
    expect(colored.clayColor).toBe('#d14a72')
    expect(`#${colored.material.color.getHexString()}`).toBe('#d14a72')
    expect(`#${colored.wireframeMaterial.color.getHexString()}`).toBe('#d14a72')

    useSceneStore.getState().setObjectShade('car', 0.5)
    const reset = useSceneStore.getState().objects[0]!
    expect(reset.clayColor).toBe('#bcbcbc')
    expect(`#${reset.material.color.getHexString()}`).toBe('#bcbcbc')
    expect(`#${reset.wireframeMaterial.color.getHexString()}`).toBe('#bcbcbc')
  })

  it('supports mixed display and restores Look and Clay materials without mutating sources', () => {
    const sourceA = new THREE.MeshStandardMaterial({ color: 0x333333 })
    const sourceB = new THREE.MeshStandardMaterial({ color: 0x777777 })
    const wire = makeObject('Wire', importedRoot(sourceA), { id: 'wire', displayMode: 'wireframe' })
    const solid = makeObject('Solid', importedRoot(sourceB), { id: 'solid' })

    applyAssetDisplay(wire, 'look')
    applyAssetDisplay(solid, 'look')

    const wireMaterial = firstMesh(wire.root).material as THREE.MeshStandardMaterial
    expect(wireMaterial).not.toBe(sourceA)
    expect(wireMaterial.wireframe).toBe(true)
    expect(firstMesh(solid.root).material).toBe(sourceB)
    expect(sourceA.wireframe).toBe(false)

    wire.displayMode = 'solid'
    applyAssetDisplay(wire, 'look')
    expect(firstMesh(wire.root).material).toBe(sourceA)

    applyAssetDisplay(wire, 'clay')
    expect(firstMesh(wire.root).material).toBe(wire.material)
  })

  it('persists, duplicates, defaults legacy metadata, and preserves display across root replacement', () => {
    const object = makeObject('Car', importedRoot(new THREE.MeshStandardMaterial()), {
      id: 'car',
      bufferKey: 'car',
      modelFormat: 'obj',
      displayMode: 'wireframe',
      clayColor: '#3a7bd5',
      triangleCount: 1200,
    })
    useSceneStore.setState({ objects: [object] })

    const metadata = toMeta(object)
    expect(metadata.displayMode).toBe('wireframe')
    expect(metadata.clayColor).toBe('#3a7bd5')
    expect(metadata.modelFormat).toBe('obj')
    expect(objectFromDenseMeta(metadata).displayMode).toBe('wireframe')
    expect(objectFromDenseMeta(metadata).clayColor).toBe('#3a7bd5')
    expect(objectFromDenseMeta(metadata).modelFormat).toBe('obj')
    useSceneStore.getState().duplicateObject('car')
    expect(useSceneStore.getState().objects[1]?.displayMode).toBe('wireframe')
    expect(useSceneStore.getState().objects[1]?.clayColor).toBe('#3a7bd5')

    const replacementSource = new THREE.MeshStandardMaterial({ color: 0x555555 })
    const replacement = importedRoot(replacementSource)
    useSceneStore.getState().replaceImportedRoot('car', replacement, [])
    const live = useSceneStore.getState().objects[0]!
    expect(live.displayMode).toBe('wireframe')
    expect(live.clayColor).toBe('#3a7bd5')
    expect(`#${live.wireframeMaterial.color.getHexString()}`).toBe('#3a7bd5')
    expect((firstMesh(live.root).material as THREE.Material & { wireframe?: boolean }).wireframe).toBe(true)
    live.displayMode = 'solid'
    applyAssetDisplay(live, 'look')
    expect(firstMesh(live.root).material).toBe(replacementSource)

    const {
      displayMode: _legacyDisplay,
      clayColor: _legacyClayColor,
      ...legacyMetadata
    } = metadata
    expect(objectFromDenseMeta(legacyMetadata).displayMode).toBe('solid')
    expect(objectFromDenseMeta(legacyMetadata).clayColor).toBe(shadeToHex(metadata.shade))
  })

  it('keeps every technical pass authoritative and restores the authored live display', () => {
    const object = makeObject('Wire', importedRoot(new THREE.MeshStandardMaterial()), {
      displayMode: 'wireframe',
    })
    for (const mode of ['depth', 'outline', 'normals'] as const) {
      applyAssetDisplay(object, mode)
      expect(firstMesh(object.root).material).toBe(object.material)
    }
    expect(object.displayMode).toBe('wireframe')

    applyAssetDisplay(object, 'look')
    expect(firstMesh(object.root).material).toBe(object.wireframeMaterial)
  })

  it('forces Solid for export without changing authored display or animation keys', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x444444 })
    const object = makeObject('Wire', importedRoot(source), {
      displayMode: 'wireframe',
      keys: [{
        id: 'position-1',
        time: 0.5,
        channel: 'position',
        transform: {
          position: [1, 2, 3],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      }],
    })
    const authoredKeys = object.keys

    applyAssetDisplay(object, 'look', 'export')
    expect(firstMesh(object.root).material).toBe(source)
    expect(object.displayMode).toBe('wireframe')
    expect(object.keys).toBe(authoredKeys)

    applyAssetDisplay(object, 'look')
    expect(firstMesh(object.root).material).toBe(object.wireframeMaterial)
  })

  it('gives primitives and dummy characters cached topology metadata', () => {
    const primitive = makePrimitive('box', { displayMode: 'wireframe', clayColor: '#d97706' })
    const dummy = makeDummyObject({ displayMode: 'wireframe', clayColor: '#16a34a' })
    expect(primitive.triangleCount).toBeGreaterThan(0)
    expect(dummy.triangleCount).toBeGreaterThan(0)
    expect(toMeta(primitive).displayMode).toBe('wireframe')
    expect(toMeta(dummy).displayMode).toBe('wireframe')
    expect(toMeta(primitive).clayColor).toBe('#d97706')
    expect(toMeta(dummy).clayColor).toBe('#16a34a')
  })

  it('shows a SAM source material only in Look and uses custom clay in Clay and Wireframe', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0xff2200 })
    const object = makeObject('SAM object', importedRoot(source), {
      keepTexture: true,
      clayColor: '#2563eb',
    })

    applyAssetDisplay(object, 'look')
    expect(firstMesh(object.root).material).toBe(source)

    applyAssetDisplay(object, 'clay')
    expect(firstMesh(object.root).material).toBe(object.material)
    expect(`#${object.material.color.getHexString()}`).toBe('#2563eb')

    object.displayMode = 'wireframe'
    applyAssetDisplay(object, 'look')
    expect(firstMesh(object.root).material).toBe(object.wireframeMaterial)
    expect(`#${object.wireframeMaterial.color.getHexString()}`).toBe('#2563eb')
  })
})
