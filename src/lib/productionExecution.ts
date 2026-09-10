import { create } from 'zustand'
import { falQueue, falUsable, uploadImage, falErrorMessage } from './fal/client'
import { GENERATE_FACE_LIMIT } from './fal/models'
import { requireModelGlb } from './fal/files'
import { idbGet, idbGetAll, idbPut, STORES } from './idb'
import { activeReferencesForItem, productionGenerationEligibility, type GenerationInputs, type ProductionItem, type ReferenceRole } from './productionWorkflow'
import { ingestProductionModel, loadProductionImage, storeProductionImage } from './productionMedia'
import { saveActiveProject, updateProjectProduction } from './projects'
import { useProjectStore } from '../state/useProjectStore'
import { useCloudAuthStore } from '../state/useCloudAuthStore'

export const PRODUCTION_IMAGE_MODEL = 'fal-ai/nano-banana-2'
export const PRODUCTION_IMAGE_MODELS = [
  { id: PRODUCTION_IMAGE_MODEL, label: 'Nano Banana 2' },
  { id: 'fal-ai/nano-banana-pro', label: 'Nano Banana Pro' },
] as const
export type ProductionImageModel = typeof PRODUCTION_IMAGE_MODELS[number]['id']
export const PRODUCTION_3D_MODEL = 'tripo3d/h3.1/image-to-3d'
export type ProductionJobStatus = 'preparing' | 'submitting' | 'queued' | 'running' | 'paused' | 'submission-unknown' | 'cancel-requested' | 'completed' | 'failed'
export interface ProductionJob extends GenerationInputs {
  id: string
  projectId: string
  itemId: string
  name: string
  ownerId: string
  stage: 'reference' | 'model'
  modelId: string
  requestId: string | null
  status: ProductionJobStatus
  error: string | null
  createdAt: string
  guidelines: string
  referenceUris: string[]
  referenceRole: ReferenceRole
  outputUri?: string
  resultAssetId?: string
}

export const useProductionJobs = create<{ jobs: ProductionJob[] }>(() => ({ jobs: [] }))
const running = new Set<string>()

export async function refreshProductionJobs() {
  const jobs = await idbGetAll<ProductionJob>(STORES.productionJobs)
  useProductionJobs.setState({ jobs })
  return jobs
}

async function persist(job: ProductionJob) {
  await idbPut(STORES.productionJobs, job)
  useProductionJobs.setState((state) => ({ jobs: [...state.jobs.filter((entry) => entry.id !== job.id), job] }))
}

async function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(`rig-production-${key}`, work)
  return work()
}

export async function startProductionJob(itemId: string, stage: ProductionJob['stage'], imageModel: ProductionImageModel = PRODUCTION_IMAGE_MODEL): Promise<string> {
  if (!PRODUCTION_IMAGE_MODELS.some((model) => model.id === imageModel)) throw new Error('Choose a supported reference model.')
  const project = useProjectStore.getState()
  const projectId = project.projectId
  if (!projectId) throw new Error('Save this project before starting production.')
  if (!falUsable()) throw new Error('Configure fal.ai in Settings before generating assets.')
  const item = project.workflow.production.items.find((entry) => entry.id === itemId)
  if (!item) throw new Error('Production requirement not found.')
  const eligibility = productionGenerationEligibility(project.workflow.production, item)
  if (!eligibility[stage]) throw new Error(eligibility.reason ?? 'Approve the requirement first.')
  if (stage === 'model' && item.backgroundMode === 'flat') throw new Error('A flat background uses its approved image. Choose 3D intent to generate a mesh.')
  const references = activeReferencesForItem(project.workflow.production, item)
  // Snapshot before awaiting: future edits must not change the meaning of this request.
  const snapshot: ProductionJob = {
    id: crypto.randomUUID(), projectId, itemId, stage, name: item.name,
    ownerId: useCloudAuthStore.getState().session?.userId ?? 'local',
    modelId: stage === 'model' ? PRODUCTION_3D_MODEL : `${imageModel}${references.length ? '/edit' : ''}`,
    requestId: null, status: 'preparing', error: null, createdAt: new Date().toISOString(),
    prompt: item.prompt, guidelineVersionId: item.guidelineVersionId, guidelineException: item.guidelineException,
    guidelines: project.guidelines, referenceVersionIds: references.map((ref) => ref.id),
    referenceUris: references.map((ref) => ref.uri), referenceRole: item.variantLabel ? 'variant' : 'primary',
  }
  return locked(`${projectId}-${itemId}-${stage}`, async () => {
    const existing = (await refreshProductionJobs()).find((job) => job.projectId === projectId && job.itemId === itemId && job.stage === stage && !['completed', 'failed'].includes(job.status))
    if (existing) throw new Error('This asset already has an unfinished request. Resume that request before starting another.')
    await saveActiveProject({ createIfMissing: false })
    await persist(snapshot)
    void resumeProductionJob(snapshot.id)
    return snapshot.id
  })
}

export function productionReferencePrompt(job: Pick<ProductionJob, 'prompt' | 'guidelines' | 'guidelineException'>): string {
  return [
    'Create one clear reference image of the described asset, with no labels, collage or watermark. Show the entire asset, unobstructed. Use a neutral background for characters and props. Preserve identity from supplied references.',
    `Project guidelines:\n${job.guidelines}`,
    `Asset:\n${job.prompt}`,
    job.guidelineException ? `Explicit asset exception:\n${job.guidelineException}` : '',
  ].filter(Boolean).join('\n\n')
}

async function requestInput(job: ProductionJob): Promise<Record<string, unknown>> {
  const images: string[] = []
  for (const uri of job.referenceUris) {
    const blob = await loadProductionImage(uri)
    images.push(await uploadImage(new File([blob], 'reference.png', { type: blob.type }), undefined, { storage: true }))
  }
  if (job.stage === 'model') {
    if (!images.length) throw new Error('The approved reference is missing.')
    return { image_url: images[images.length - 1], texture: false, pbr: false, quad: false,
      face_limit: GENERATE_FACE_LIMIT, geometry_quality: 'standard' }
  }
  return { prompt: productionReferencePrompt(job), num_images: 1, output_format: 'png', resolution: '1K', aspect_ratio: '1:1',
    ...(images.length ? { image_urls: images } : {}) }
}

function recordValue(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The provider returned an invalid result.')
  return data as Record<string, unknown>
}

function outputUrl(job: ProductionJob, data: unknown): string {
  const result = recordValue(data)
  if (job.stage === 'model') return requireModelGlb(result, job.modelId)
  const first = Array.isArray(result.images) ? result.images[0] : undefined
  const url = first && recordValue(first).url
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('The provider returned no reference image.')
  return url
}

async function attachResult(job: ProductionJob) {
  const uri = job.outputUri
  if (!uri) throw new Error('The provider returned no output.')
  if (job.stage === 'reference') {
    const blob = await loadProductionImage(uri)
    const storedUri = await storeProductionImage(blob, job.id)
    await updateProjectProduction(job.projectId, (list) => ({ ...list, items: list.items.map((item) => {
      if (item.id !== job.itemId || item.referenceVersions.some((ref) => ref.id === job.id)) return item
      return { ...item, referenceVersions: [...item.referenceVersions, {
        id: job.id, label: `${job.name} reference`, uri: storedUri, role: job.referenceRole,
        status: 'needs-review', createdAt: job.createdAt, approvedAt: null,
        prompt: job.prompt, guidelineVersionId: job.guidelineVersionId, guidelineException: job.guidelineException,
      }] }
    }) }))
  } else {
    const assetId = await ingestProductionModel({ id: `production-${job.id}`, name: job.name, ownerId: job.ownerId, url: uri })
    job.resultAssetId = assetId
    await updateProjectProduction(job.projectId, (list) => ({ ...list, items: list.items.map((item) => {
      if (item.id !== job.itemId || item.modelResults.some((result) => result.id === job.id)) return item
      return { ...item, modelResults: [...item.modelResults, {
        id: job.id, libraryAssetId: assetId, status: 'needs-review', createdAt: job.createdAt, reviewedAt: null,
        prompt: job.prompt, guidelineVersionId: job.guidelineVersionId, guidelineException: job.guidelineException,
        referenceVersionIds: job.referenceVersionIds,
      }] }
    }) }))
  }
}

/** Resume the same remote request. Unknown submission outcomes never auto-submit twice. */
export async function resumeProductionJob(id: string): Promise<void> {
  if (running.has(id)) return
  running.add(id)
  try {
    await locked(id, async () => {
      let job = await idbGet<ProductionJob>(STORES.productionJobs, id)
      if (!job || job.status === 'completed' || job.status === 'failed') return
      if (!job.requestId && ['submitting', 'submission-unknown'].includes(job.status)) {
        await persist({ ...job, status: 'submission-unknown', error: 'Submission could not be confirmed. Check fal.ai request history before retrying to avoid duplicate charges.' })
        return
      }
      try {
        if (!job.requestId) {
          const input = await requestInput(job)
          job = { ...job, status: 'submitting', error: null }
          await persist(job)
          const requestId = await falQueue.submit(job.modelId, input)
          job = { ...job, requestId, status: 'queued' }
          await persist(job)
        }
        if (!job.outputUri) {
          for (;;) {
            const status = await falQueue.status(job.modelId, job.requestId!)
            if (status.status === 'COMPLETED') break
            const saved = await idbGet<ProductionJob>(STORES.productionJobs, id)
            job = { ...job, status: saved?.status === 'cancel-requested' ? 'cancel-requested' : status.status === 'IN_PROGRESS' ? 'running' : 'queued', error: null }
            await persist(job)
            await new Promise((resolve) => setTimeout(resolve, 2000))
          }
          const result = await falQueue.result(job.modelId, job.requestId!)
          job = { ...job, outputUri: outputUrl(job, result) }
          await persist(job)
        }
        await attachResult(job)
        await persist({ ...job, status: 'completed', error: null })
      } catch (error) {
        const status = job.requestId ? 'paused' : job.status === 'submitting' ? 'submission-unknown' : 'failed'
        await persist({ ...job, status, error: falErrorMessage(error, 'Production stopped. Resume the saved request to try again.') })
      }
    })
  } finally { running.delete(id) }
}

export async function cancelProductionJob(id: string) {
  const job = await idbGet<ProductionJob>(STORES.productionJobs, id)
  if (!job?.requestId || job.status === 'completed') return
  await falQueue.cancel(job.modelId, job.requestId)
  await persist({ ...job, status: 'cancel-requested', error: 'Cancellation requested. Work already running may still finish and be billed.' })
}

/** Recover an acknowledged request from provider history after an uncertain submission. */
export async function recoverProductionRequest(id: string, requestId: string) {
  const job = await idbGet<ProductionJob>(STORES.productionJobs, id)
  if (!job || job.requestId || !['submitting', 'submission-unknown'].includes(job.status)) return
  const remoteId = requestId.trim()
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(remoteId)) throw new Error('Enter the request ID from fal.ai history.')
  await falQueue.status(job.modelId, remoteId)
  await persist({ ...job, requestId: remoteId, status: 'queued', error: null })
  void resumeProductionJob(id)
}

export async function uploadProductionReference(item: ProductionItem, file: File) {
  const projectId = useProjectStore.getState().projectId
  if (!projectId || item.requirementStatus !== 'approved' || item.promptStatus !== 'approved') {
    throw new Error('Approve the requirement before uploading its reference.')
  }
  const uri = await storeProductionImage(file)
  const id = crypto.randomUUID()
  await updateProjectProduction(projectId, (list) => ({ ...list, items: list.items.map((current) => current.id !== item.id ? current : {
    ...current, referenceVersions: [...current.referenceVersions, {
      id, label: file.name, uri, role: item.variantLabel ? 'variant' : 'primary', status: 'needs-review',
      createdAt: new Date().toISOString(), approvedAt: null, prompt: item.prompt,
      guidelineVersionId: item.guidelineVersionId, guidelineException: item.guidelineException,
    }],
  }) }))
}
