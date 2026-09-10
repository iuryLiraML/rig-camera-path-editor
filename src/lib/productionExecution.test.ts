import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectStore } from '../state/useProjectStore'
import { addProductionItem, addReferenceVersion, approveProductionItems, approveReferenceVersion, createProductionList } from './productionWorkflow'
import { startProductionJob, recoverProductionRequest, resumeProductionJob, refreshProductionJobs, useProductionJobs, type ProductionJob } from './productionExecution'
import { falQueue } from './fal/client'
import { ingestProductionModel } from './productionMedia'

const storage = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./idb', () => ({
  STORES: { productionJobs: 'jobs' },
  idbGet: vi.fn(async (_store, id) => structuredClone(storage.get(id))),
  idbGetAll: vi.fn(async () => Array.from(storage.values()).map((row) => structuredClone(row))),
  idbPut: vi.fn(async (_store, row) => { storage.set(row.id, structuredClone(row)) }),
}))
vi.mock('./fal/client', () => ({
  falUsable: () => true,
  falErrorMessage: (error: Error) => error.message,
  falQueue: { submit: vi.fn(), status: vi.fn(), result: vi.fn(), cancel: vi.fn() },
  uploadImage: vi.fn(async () => 'https://files.example/reference.png'),
}))
vi.mock('./productionMedia', () => ({
  loadProductionImage: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  storeProductionImage: vi.fn(async (_blob, id) => `production-media:${id}`),
  ingestProductionModel: vi.fn(async ({ id }) => id),
}))
vi.mock('../state/useCloudAuthStore', () => ({ useCloudAuthStore: { getState: () => ({ session: null }) } }))
const records = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./projects', () => ({
  saveActiveProject: vi.fn(async () => {}),
  updateProjectProduction: vi.fn(async (projectId, edit) => {
    const store = useProjectStore.getState()
    const next = edit(records.get(projectId) ?? store.workflow.production)
    records.set(projectId, next)
    if (projectId === store.projectId) store.setProduction(next)
  }),
}))

function prepare() {
  let list = addProductionItem(createProductionList(), { name: 'Chair', kind: 'prop', provenance: 'explicit', quantity: 10, sceneIds: [], prompt: 'One bentwood chair' })
  const id = list.items[0].id
  list = approveProductionItems(list, [id], 'guidelines-v1')
  const reference = addReferenceVersion(list, id, { label: 'Chair reference', uri: 'https://files.example/chair.png' })
  if (!reference.ok) throw new Error(reference.error)
  list = approveReferenceVersion(reference.list, id, reference.list.items[0].referenceVersions[0].id)
  useProjectStore.setState({ projectId: 'project-1', guidelines: 'Quiet modern design' })
  useProjectStore.getState().setProduction(list)
  return id
}

beforeEach(() => {
  vi.clearAllMocks(); storage.clear(); records.clear()
  useProductionJobs.setState({ jobs: [] })
  vi.mocked(falQueue.submit).mockResolvedValue('remote-request-1')
  vi.mocked(falQueue.status).mockResolvedValue({ status: 'COMPLETED', request_id: 'remote-request-1', response_url: '', status_url: '', cancel_url: '', logs: [] })
  vi.mocked(falQueue.result).mockResolvedValue({ model_mesh: { url: 'https://files.example/chair.glb' } })
})

describe('production execution', () => {
  it('runs a real adapter boundary, produces one reusable model for ten instances and retains unapproved inputs/results', async () => {
    const itemId = prepare()
    const id = await startProductionJob(itemId, 'model')
    await vi.waitFor(() => expect(useProductionJobs.getState().jobs[0]?.status).toBe('completed'))
    expect(falQueue.submit).toHaveBeenCalledExactlyOnceWith('tripo3d/h3.1/image-to-3d', expect.objectContaining({ image_url: 'https://files.example/reference.png', texture: false, pbr: false }))
    expect(ingestProductionModel).toHaveBeenCalledWith(expect.objectContaining({ id: `production-${id}` }))
    const result = useProjectStore.getState().workflow.production.items[0]
    expect(result.modelResults[0]).toMatchObject({ status: 'needs-review', prompt: 'One bentwood chair' })
    expect(result.fulfilledByAssetId).toBeNull()
    expect(result.quantity).toBe(10)
  })

  it('persists output against the original project and prompt after navigation', async () => {
    const itemId = prepare()
    const original = useProjectStore.getState().workflow.production
    let finish!: (value: unknown) => void
    vi.mocked(falQueue.result).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await startProductionJob(itemId, 'model')
    await vi.waitFor(() => expect(falQueue.result).toHaveBeenCalled())
    records.set('project-1', original)
    useProjectStore.setState({ projectId: 'project-2' })
    useProjectStore.getState().setProduction(createProductionList())
    finish({ model_mesh: { url: 'https://files.example/chair.glb' } })
    await vi.waitFor(() => expect(useProductionJobs.getState().jobs[0]?.status).toBe('completed'))
    expect(useProjectStore.getState().workflow.production.items).toEqual([])
    expect(records.get('project-1')).toMatchObject({ items: [{ modelResults: [{ prompt: 'One bentwood chair' }] }] })
  })

  it('resumes a saved request after a transient polling failure without resubmitting', async () => {
    const itemId = prepare()
    vi.mocked(falQueue.status).mockRejectedValueOnce(new Error('Network unavailable'))
    const id = await startProductionJob(itemId, 'model')
    await vi.waitFor(() => expect(useProductionJobs.getState().jobs[0]?.status).toBe('paused'))
    useProductionJobs.setState({ jobs: [] })
    await refreshProductionJobs()
    await resumeProductionJob(id)
    expect(falQueue.submit).toHaveBeenCalledTimes(1)
    expect(falQueue.status).toHaveBeenLastCalledWith('tripo3d/h3.1/image-to-3d', 'remote-request-1')
    expect(useProductionJobs.getState().jobs[0].status).toBe('completed')
  })

  it('does not resubmit an ambiguous paid submission', async () => {
    const itemId = prepare()
    vi.mocked(falQueue.submit).mockRejectedValueOnce(new Error('Connection closed after sending'))
    const id = await startProductionJob(itemId, 'model')
    await vi.waitFor(() => expect(useProductionJobs.getState().jobs[0]?.status).toBe('submission-unknown'))
    await resumeProductionJob(id)
    expect(falQueue.submit).toHaveBeenCalledTimes(1)
    await expect(startProductionJob(itemId, 'model')).rejects.toThrow('unfinished')
  })

  it('creates locally retained reference versions from Nano Banana and preserves guideline text in the request', async () => {
    const itemId = prepare()
    vi.mocked(falQueue.result).mockResolvedValueOnce({ images: [{ url: 'https://files.example/new.png' }] })
    await startProductionJob(itemId, 'reference')
    await vi.waitFor(() => expect(useProductionJobs.getState().jobs[0]?.status).toBe('completed'))
    expect(falQueue.submit).toHaveBeenCalledWith('fal-ai/nano-banana-2/edit', expect.objectContaining({ prompt: expect.stringContaining('Quiet modern design'), image_urls: ['https://files.example/reference.png'] }))
    expect(useProjectStore.getState().workflow.production.items[0].referenceVersions).toHaveLength(2)
    expect(useProjectStore.getState().workflow.production.items[0].referenceVersions[1]).toMatchObject({ status: 'needs-review', uri: expect.stringContaining('production-media:') })
  })

  it('re-attaching a completed result does not duplicate model reviews', async () => {
    const itemId = prepare()
    const id = await startProductionJob(itemId, 'model')
    await vi.waitFor(() => expect(useProductionJobs.getState().jobs[0]?.status).toBe('completed'))
    const completed = storage.get(id) as ProductionJob
    storage.set(id, { ...completed, status: 'paused' })
    await resumeProductionJob(id)
    expect(useProjectStore.getState().workflow.production.items[0].modelResults).toHaveLength(1)
    expect(falQueue.submit).toHaveBeenCalledTimes(1)
  })
  it('recovers an uncertain submission using a provider request ID without a second paid submission', async () => {
    const itemId = prepare()
    vi.mocked(falQueue.submit).mockRejectedValueOnce(new Error('Lost response'))
    const id = await startProductionJob(itemId, 'model')
    await vi.waitFor(() => expect(useProductionJobs.getState().jobs[0]?.status).toBe('submission-unknown'))
    await recoverProductionRequest(id, 'recovered-request-1')
    await vi.waitFor(() => expect(useProductionJobs.getState().jobs[0]?.status).toBe('completed'))
    expect(falQueue.submit).toHaveBeenCalledTimes(1)
    expect(falQueue.result).toHaveBeenCalledWith('tripo3d/h3.1/image-to-3d', 'recovered-request-1')
  })

  it('keeps the selected image model when a reference request is resumed', async () => {
    const itemId = prepare()
    vi.mocked(falQueue.status).mockRejectedValueOnce(new Error('Network unavailable'))
    vi.mocked(falQueue.result).mockResolvedValueOnce({ images: [{ url: 'https://files.example/new.png' }] })
    const id = await startProductionJob(itemId, 'reference', 'fal-ai/nano-banana-pro')
    await vi.waitFor(() => expect(useProductionJobs.getState().jobs[0]?.status).toBe('paused'))
    await resumeProductionJob(id)
    expect(falQueue.submit).toHaveBeenCalledExactlyOnceWith('fal-ai/nano-banana-pro/edit', expect.any(Object))
    expect(falQueue.result).toHaveBeenCalledWith('fal-ai/nano-banana-pro/edit', 'remote-request-1')
  })

})
