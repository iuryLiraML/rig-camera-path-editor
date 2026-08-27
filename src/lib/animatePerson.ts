import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { configureFal, falUsable, uploadFile } from './fal/client'
import { animatePersonWithMeshy } from './fal/meshyAnimation'
import { readFalSettings } from './fal/settings'
import { persistModelBuffer, fileFromStoredBuffer } from './readModelFile'
import { prepareImportedRoot } from './prepareImport'
import { isolateSharedObjectBuffer } from './environmentJobs'
import { normalizeModel } from '../state/useSceneStore'
import { useSceneStore } from '../state/useSceneStore'

function parseGLB(buffer: ArrayBuffer) {
  return new Promise<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] }>((resolve, reject) => {
    new GLTFLoader().parse(
      buffer,
      '',
      (gltf) => resolve({ scene: gltf.scene, clips: gltf.animations ?? [] }),
      reject,
    )
  })
}

export async function animateSelectedPerson(objectId: string) {
  const scene = useSceneStore.getState()
  const object = scene.objects.find((item) => item.id === objectId)
  if (!object || object.rigKind !== 'sam-person') return
  if (!falUsable()) {
    scene.showNotice('Add your Fal API key in Settings first.')
    return
  }
  if (!object.bufferKey) {
    scene.showNotice('This person has no stored mesh to animate.')
    return
  }
  const liftId = scene.beginLift(`${object.name} — Animate…`, 'generate', objectId)
  try {
    configureFal(readFalSettings().falKey)
    const file = await fileFromStoredBuffer(object.bufferKey, `${object.name}.glb`, 'model/gltf-binary')
    if (!file) throw new Error('Could not read the stored mesh.')
    const modelUrl = await uploadFile(file)
    const { buffer, extraBuffers } = await animatePersonWithMeshy({ modelUrl })
    const parsed = await parseGLB(buffer)
    const extraClips = (
      await Promise.all(extraBuffers.map((item) => parseGLB(item)))
    ).flatMap((item) => item.clips)
    const clips = [...parsed.clips, ...extraClips]
    prepareImportedRoot(parsed.scene)
    normalizeModel(parsed.scene)
    scene.replaceImportedRoot(objectId, parsed.scene, clips)
    scene.setPlayClips(objectId, true)
    const idle = clips.find((clip) => /idle/i.test(clip.name))
    if (idle) scene.setActiveClip(objectId, idle.name)
    const writeKey = (await isolateSharedObjectBuffer(objectId)) ?? object.bufferKey
    await persistModelBuffer(writeKey, buffer)
    scene.endLift(liftId)
    scene.showNotice(`Animated "${object.name}"`)
  } catch (error) {
    scene.endLift(liftId)
    scene.showNotice(error instanceof Error ? error.message : 'Animate failed')
  }
}
