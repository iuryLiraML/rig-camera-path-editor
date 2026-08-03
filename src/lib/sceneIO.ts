import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  makeDefaultKnotObject,
  makeObject,
  makePrimitive,
  normalizeModel,
  objectGraveyard,
  useSceneStore,
  type FollowConfig,
  type SceneObject,
  type Transform,
} from '../state/useSceneStore'
import type { PrimitiveSpec } from './primitiveGeometry'
import { useRigStore } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useEditorStore } from '../state/useEditorStore'
import { makeEmptyRigSnapshot, useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { idbDelete, idbGet, idbKeys, idbPut, STORES } from './idb'
import { resetHistory } from './history'
import type { ModelKey } from './keyframes'

/** legacy (pre-projects) localStorage key — still read for migration */
export const LEGACY_META_KEY = 'rig-scene-objects'
const HEAVY_TRIANGLES = 1_500_000

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function parseGLB(buffer: ArrayBuffer) {
  return new Promise<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] }>(
    (resolve, reject) => {
      new GLTFLoader().parse(
        buffer,
        '',
        (gltf) => resolve({ scene: gltf.scene, clips: gltf.animations ?? [] }),
        reject,
      )
    },
  )
}

function countTriangles(root: THREE.Object3D): number {
  let total = 0
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry = child.geometry as THREE.BufferGeometry
      total += (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3
    }
  })
  return Math.round(total)
}

/** Imports a .glb/.gltf file as a new scene object and persists its buffer. */
export async function importModelFile(file: File): Promise<{
  objectId: string
  objectName: string
  byteSize: number
} | null> {
  const scene = useSceneStore.getState()
  const name = file.name.replace(/\.(glb|gltf)$/i, '')
  scene.setImporting(1)
  try {
    const buffer = await file.arrayBuffer()
    const { scene: root, clips } = await parseGLB(buffer)
    normalizeModel(root)
    const object = makeObject(name, root, { bufferKey: null, clips })
    object.bufferKey = object.id
    useSceneStore.getState().addObject(object)

    const triangles = countTriangles(root)
    if (triangles > HEAVY_TRIANGLES) {
      scene.showNotice(
        `"${name}" is heavy (${(triangles / 1e6).toFixed(1)}M triangles) — expect low FPS`,
      )
    } else {
      scene.showNotice(
        clips.length ? `"${name}" imported (${clips.length} animation clips)` : `"${name}" imported`,
      )
    }
    idbPut(STORES.buffers, buffer, object.id).catch((e) =>
      console.error('Failed to persist model buffer', e),
    )
    return { objectId: object.id, objectName: object.name, byteSize: buffer.byteLength }
  } catch (error) {
    console.error('Failed to import model', error)
    scene.showNotice('Could not read this file — use a self-contained .glb')
    return null
  } finally {
    useSceneStore.getState().setImporting(-1)
  }
}

export function openImportDialog() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.glb,.gltf'
  input.multiple = true
  input.onchange = () => {
    for (const file of input.files ?? []) void importModelFile(file)
  }
  input.click()
}

// ---------------------------------------------------------------------------
// Scene <-> serializable metadata
// ---------------------------------------------------------------------------

export interface ObjectMeta {
  id: string
  name: string
  shade: number
  bufferKey: string | null
  primitive?: PrimitiveSpec
  transform: Transform
  keys: ModelKey[]
  playClips: boolean
  follow?: FollowConfig
}

export function toMeta(o: SceneObject): ObjectMeta {
  return {
    id: o.id,
    name: o.name,
    shade: o.shade,
    bufferKey: o.bufferKey,
    primitive: o.primitive,
    transform: o.transform,
    keys: o.keys,
    playClips: o.playClips,
    follow: o.follow,
  }
}

export function liveSceneMetas(): ObjectMeta[] {
  return useSceneStore.getState().objects.map(toMeta)
}

/** Clears the current scene and rebuilds it from metadata + stored buffers. */
export async function loadSceneFromMetas(metas: ObjectMeta[], seedIfEmpty = true) {
  objectGraveyard.clear()
  useSceneStore.setState({ objects: [] })

  for (const meta of metas) {
    try {
      let object: SceneObject
      if (meta.primitive) {
        object = makePrimitive(meta.primitive.kind, { ...meta, params: meta.primitive.params })
        object.name = meta.name
      } else if (meta.bufferKey === null) {
        object = makeDefaultKnotObject(meta)
        object.name = meta.name
      } else {
        const buffer = await idbGet<ArrayBuffer>(STORES.buffers, meta.bufferKey)
        if (!buffer) continue // buffer lost (cleared storage) — skip quietly
        const { scene: root, clips } = await parseGLB(buffer)
        normalizeModel(root)
        object = makeObject(meta.name, root, { ...meta, clips })
      }
      useSceneStore.getState().addObject(object)
    } catch (e) {
      console.error('Failed to restore object', meta.name, e)
    }
  }

  if (seedIfEmpty && useSceneStore.getState().objects.length === 0) {
    useSceneStore.getState().addObject(makeDefaultKnotObject())
  }
}

/** Legacy metas from before the projects system (for first-boot migration). */
export function readLegacyMetas(): ObjectMeta[] | null {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_META_KEY) ?? 'null')
  } catch {
    return null
  }
}

export async function sweepOrphanBuffers(liveKeys: Set<string>) {
  try {
    for (const key of await idbKeys(STORES.buffers)) {
      if (!liveKeys.has(key)) await idbDelete(STORES.buffers, key)
    }
  } catch (e) {
    console.error('Failed to sweep orphan buffers', e)
  }
}

/** Wipes the CURRENT project's scene and rig back to a fresh single shape. */
export async function resetScene() {
  const emptyRig = makeEmptyRigSnapshot()
  useRigStore.setState({ ...emptyRig, playing: false, t: 0 })
  usePathStore.setState({
    paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
    selectedAnchorId: null,
    selectedHandle: 'none',
    drawPlaneY: 1.2,
  })
  useCameraOptionsStore.getState().loadOptions(undefined, undefined, emptyRig)
  useSceneStore.setState({
    objects: [makeDefaultKnotObject()],
    bgColor: '#efc8c4',
    showGrid: true,
    lightIntensity: 1.4,
  })
  objectGraveyard.clear()
  const editor = useEditorStore.getState()
  editor.select(null)
  editor.setTool('select')
  editor.setCameraView(false)
  resetHistory()
  useSceneStore.getState().showNotice('Scene reset')
}
