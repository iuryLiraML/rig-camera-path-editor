import { useEffect, useState } from 'react'
import { cancelProductionJob, recoverProductionRequest, refreshProductionJobs, resumeProductionJob, startProductionJob, uploadProductionReference, useProductionJobs, PRODUCTION_IMAGE_MODEL, PRODUCTION_IMAGE_MODELS, type ProductionImageModel, type ProductionJob, PRODUCTION_3D_MODEL } from '../lib/productionExecution'
import { loadProductionImage } from '../lib/productionMedia'
import { productionGenerationEligibility, type ProductionItem } from '../lib/productionWorkflow'
import { useProjectStore } from '../state/useProjectStore'

const button = 'rounded-md border border-line bg-panel px-3 py-2 text-xs text-ink hover:bg-panel-3 disabled:opacity-40'

export function ProductionReferenceImage({ uri, label }: { uri: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    let objectUrl: string | undefined
    setUrl(null)
    setFailed(false)
    void loadProductionImage(uri).then((blob) => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [uri])
  if (failed) return <p className="mt-2 text-xs text-amber-300">Reference unavailable. Upload the image again to preview it.</p>
  if (!url) return <p className="mt-2 text-xs text-ink-dim">Loading reference…</p>
  return <img src={url} alt={label} className="mt-2 max-h-56 w-full rounded-md bg-black/20 object-contain" onError={() => setFailed(true)} />
}

function RecoverRequest({ job, onError }: { job: ProductionJob; onError: (message: string) => void }) {
  const [requestId, setRequestId] = useState('')
  const [busy, setBusy] = useState(false)
  return <form className="mt-2 space-y-2" onSubmit={(event) => {
    event.preventDefault()
    setBusy(true)
    void recoverProductionRequest(job.id, requestId).catch((failure) => onError(String(failure))).finally(() => setBusy(false))
  }}>
    <a href="https://fal.ai/dashboard/requests" target="_blank" rel="noreferrer" className="text-accent">Open fal.ai request history</a>
    <label className="block">Request ID<input aria-label="Recover request ID" value={requestId} onChange={(event) => setRequestId(event.target.value)} className="mt-1 w-full rounded border border-line bg-panel px-2 py-1" /></label>
    <button className={button} disabled={busy || !requestId.trim()}>Recover saved request</button>
  </form>
}

export function ProductionGenerationControls({ itemIds, stage, compact = false }: { itemIds: string[]; stage: 'reference' | 'model'; compact?: boolean }) {
  const projectId = useProjectStore((state) => state.projectId)
  const list = useProjectStore((state) => state.workflow.production)
  const jobs = useProductionJobs((state) => state.jobs)
  const [imageModel, setImageModel] = useState<ProductionImageModel>(PRODUCTION_IMAGE_MODEL)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eligible = list.items.filter((item) => itemIds.includes(item.id) && productionGenerationEligibility(list, item)[stage] && !(stage === 'model' && item.backgroundMode === 'flat'))
  const itemJobs = jobs.filter((job) => job.projectId === projectId && itemIds.includes(job.itemId) && job.stage === stage)

  useEffect(() => { void refreshProductionJobs().catch(() => {}) }, [projectId])
  useEffect(() => { setConfirm(false); setError(null) }, [projectId, stage, itemIds.join(',')])

  const generate = async () => {
    setBusy(true)
    setError(null)
    const failures: string[] = []
    for (const item of eligible) {
      try { await startProductionJob(item.id, stage, imageModel) }
      catch (failure) { failures.push(`${item.name}: ${failure instanceof Error ? failure.message : 'Unable to start.'}`) }
    }
    if (failures.length) setError(failures.join(' '))
    setConfirm(false)
    setBusy(false)
  }
  return <div className={compact ? '' : 'mt-3 space-y-2'}>
    {stage === 'reference' && <label className="mb-2 block text-xs text-ink-dim">Image model<select aria-label="Image model" value={imageModel} disabled={busy || confirm} onChange={(event) => setImageModel(event.target.value as ProductionImageModel)} className="ml-2 rounded border border-line bg-panel px-2 py-1 text-ink">{PRODUCTION_IMAGE_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>}
    <button className={button} disabled={!eligible.length || busy} onClick={() => setConfirm(true)}>{stage === 'reference' ? 'Generate references' : 'Generate 3D assets'}{compact ? ` (${eligible.length})` : ''}</button>
    {confirm && <div role="group" aria-label="Confirm generation" className="my-3 rounded-lg border border-accent/40 bg-panel-2 p-3 text-xs text-ink">
      <p>{eligible.length} {stage === 'reference' ? 'reference image' : '3D model'}{eligible.length === 1 ? '' : 's'} · {stage === 'reference' ? PRODUCTION_IMAGE_MODELS.find((model) => model.id === imageModel)?.label : 'Tripo H3.1'}</p>
      <p className="mt-2 leading-5 text-ink-dim">One generation per selected asset, regardless of instance quantity. fal.ai charges apply. Final cost depends on your provider account. Results require your approval.</p>
      <a className="mt-1 block text-accent" href={`https://fal.ai/models/${stage === 'reference' ? imageModel : PRODUCTION_3D_MODEL}`} target="_blank" rel="noreferrer">View model and pricing</a>
      <div className="mt-3 flex gap-2"><button className={button} disabled={busy} onClick={() => void generate()}>Confirm and generate</button><button className={button} disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></div>
    </div>}
    {!compact && itemJobs.map((job) => <div key={job.id} className="rounded-md border border-line p-2 text-xs text-ink">
      <div className="flex items-center justify-between gap-2"><span>{job.stage === 'reference' ? 'Reference' : '3D'} · {job.status.replaceAll('-', ' ')}</span>{['preparing', 'paused', 'queued', 'running', 'cancel-requested'].includes(job.status) && <button className="text-accent" onClick={() => void resumeProductionJob(job.id).catch((failure) => setError(String(failure)))}>Resume</button>}</div>
      <p className="mt-1 text-ink-dim">{job.modelId}</p>
      {job.status === 'submission-unknown' && <RecoverRequest job={job} onError={setError} />}
      {job.error && <p className="mt-2 text-amber-300">{job.error}</p>}
      {job.requestId && !['completed', 'failed', 'cancel-requested'].includes(job.status) && <button className="mt-2 text-ink-dim hover:text-ink" onClick={() => void cancelProductionJob(job.id).catch((failure) => setError(String(failure)))}>Request cancellation</button>}
    </div>)}
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
  </div>
}

export function UploadProductionReference({ item }: { item: ProductionItem }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <div className="mt-2">
    <label className={`${button} block cursor-pointer text-center`}>{busy ? 'Saving reference…' : 'Upload reference image'}
      <input aria-label="Upload reference image" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy || item.requirementStatus !== 'approved'} onChange={(event) => {
        const file = event.target.files?.[0]
        event.currentTarget.value = ''
        if (!file) return
        setBusy(true); setError(null)
        void uploadProductionReference(item, file).catch((failure) => setError(failure instanceof Error ? failure.message : 'Upload failed.')).finally(() => setBusy(false))
      }} />
    </label>
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
  </div>
}
