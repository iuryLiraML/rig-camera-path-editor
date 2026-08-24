import { configureFal, falUsable, uploadFile, uploadImage } from './fal/client'
import { generateFromImage, generateFromText } from './fal/generate3d'
import { downloadGlb } from './fal/lift'
import { remeshGlb } from './fal/remesh'
import { readFalSettings } from './fal/settings'
import { idbGet, STORES } from './idb'
import { importModelBuffer, replaceImportedBuffer } from './sceneIO'
import { useSceneStore } from '../state/useSceneStore'

const busy = new Set<string>()
const controllers = new Map<string, AbortController>()

function notice(error: unknown) {
  useSceneStore.getState().showNotice(error instanceof Error ? error.message : String(error))
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  const message = 'message' in error ? String(error.message) : ''
  return name === 'AbortError' || /abort/i.test(message)
}

function prepareFal() {
  const { falKey } = readFalSettings()
  configureFal(falKey)
  if (!falUsable()) throw new Error('Add your Fal API key in Settings first.')
}

function beginJob(busyKey: string, name: string, kind: 'generate' | 'remesh', objectId?: string) {
  const scene = useSceneStore.getState()
  const liftId = scene.beginLift(name, kind, objectId)
  busy.add(busyKey)
  const controller = new AbortController()
  controllers.set(liftId, controller)
  return { liftId, signal: controller.signal, scene }
}

function endJob(busyKey: string, liftId: string) {
  controllers.delete(liftId)
  busy.delete(busyKey)
  useSceneStore.getState().endLift(liftId)
}

export function cancelMeshJob(liftId: string) {
  controllers.get(liftId)?.abort()
}

export async function generateObjectFromText(prompt: string): Promise<void> {
  try {
    prepareFal()
  } catch (error) {
    notice(error)
    return
  }
  if (busy.has('generate')) {
    useSceneStore.getState().showNotice('A generate job is already running.')
    return
  }
  const name = prompt.trim().slice(0, 40) || 'Generated'
  const { liftId, signal, scene } = beginJob('generate', `${name} — Generating…`, 'generate')
  try {
    const url = await generateFromText({ prompt, signal })
    const buffer = await downloadGlb(url, signal)
    const imported = await importModelBuffer(buffer, name)
    if (!imported) scene.showNotice('Generated a model but it could not be imported.')
  } catch (error) {
    scene.showNotice(isAbortError(error) ? 'Generation cancelled.' : error instanceof Error ? error.message : String(error))
  } finally {
    endJob('generate', liftId)
  }
}

export async function generateObjectFromImage(file: File): Promise<void> {
  try {
    prepareFal()
  } catch (error) {
    notice(error)
    return
  }
  if (busy.has('generate')) {
    useSceneStore.getState().showNotice('A generate job is already running.')
    return
  }
  const name = file.name.replace(/\.[^.]+$/, '') || 'Generated'
  const { liftId, signal, scene } = beginJob('generate', `${name} — Generating…`, 'generate')
  try {
    const imageUrl = await uploadImage(file, signal)
    const url = await generateFromImage({ imageUrl, signal })
    const buffer = await downloadGlb(url, signal)
    const imported = await importModelBuffer(buffer, name)
    if (!imported) scene.showNotice('Generated a model but it could not be imported.')
  } catch (error) {
    scene.showNotice(isAbortError(error) ? 'Generation cancelled.' : error instanceof Error ? error.message : String(error))
  } finally {
    endJob('generate', liftId)
  }
}

export async function remeshSceneObject(objectId: string): Promise<void> {
  try {
    prepareFal()
  } catch (error) {
    notice(error)
    return
  }
  const key = `remesh:${objectId}`
  if (busy.has(key)) {
    useSceneStore.getState().showNotice('That object is already remeshing.')
    return
  }
  const scene = useSceneStore.getState()
  const object = scene.objects.find((item) => item.id === objectId)
  if (!object?.bufferKey) {
    scene.showNotice('Only imported models can be remeshed.')
    return
  }
  const buffer = await idbGet<ArrayBuffer>(STORES.buffers, object.bufferKey)
  if (!buffer) {
    scene.showNotice('The original file is missing — re-import the model first.')
    return
  }
  const { liftId, signal } = beginJob(key, `${object.name} — Remeshing…`, 'remesh', objectId)
  try {
    const file = new File([buffer], `${object.name}.glb`, { type: 'model/gltf-binary' })
    const meshUrl = await uploadFile(file, signal)
    const url = await remeshGlb({ meshUrl, signal })
    const next = await downloadGlb(url, signal)
    await replaceImportedBuffer(objectId, next)
    useSceneStore.getState().showNotice(`Remeshed “${object.name}”. Undo restores the original mesh.`)
  } catch (error) {
    useSceneStore
      .getState()
      .showNotice(isAbortError(error) ? 'Remesh cancelled.' : error instanceof Error ? error.message : String(error))
  } finally {
    endJob(key, liftId)
  }
}
