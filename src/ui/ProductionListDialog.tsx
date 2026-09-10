import { useEffect, useMemo, useState } from 'react'
import { ProductionGenerationControls, ProductionReferenceImage, UploadProductionReference } from './ProductionGenerationControls'
import {
  importLibraryAsset,
  listLibraryAssets,
  useLibraryStore,
  type LibraryAsset,
} from '../lib/library'
import {
  addProductionItem,
  addReferenceVersion,
  acknowledgeProductionDiff,
  approveProductionItems,
  approveReferenceVersion,
  referenceMatchesCurrentInputs,
  fulfillProductionItem,
  markProductionItemsNoLongerRequired,
  modelResultMatchesCurrentInputs,
  productionGenerationEligibility,
  reviewModelResult,
  restoreProductionItems,
  updateProductionItem,
  type ProductionItem,
  type ProductionItemKind,
  type ProductionList,
} from '../lib/productionWorkflow'
import { useEditorStore } from '../state/useEditorStore'
import { updateProjectProduction } from '../lib/projects'
import { useProjectStore } from '../state/useProjectStore'

const STATUS_LABEL = {
  'needs-review': 'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
  'no-longer-required': 'No longer required',
} as const

function replaceProduction(production: ProductionList) {
  useProjectStore.getState().setProduction(production)
}

function statusClass(status: keyof typeof STATUS_LABEL) {
  if (status === 'approved') return 'bg-emerald-500/15 text-emerald-300'
  if (status === 'rejected') return 'bg-red-500/15 text-red-300'
  if (status === 'no-longer-required') return 'bg-panel-3 text-ink-dim'
  return 'bg-amber-500/15 text-amber-300'
}

function StatusChip({ status }: { status: keyof typeof STATUS_LABEL }) {
  return <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] ${statusClass(status)}`}>{STATUS_LABEL[status]}</span>
}

function AssetPreview({ asset }: { asset: LibraryAsset | undefined }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!asset?.thumbnail) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(asset.thumbnail)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [asset?.thumbnail])
  if (!url) return null
  return <img src={url} alt={`${asset?.name ?? 'Asset'} preview`} className="mt-2 h-24 w-full rounded-md bg-black/20 object-contain" />
}

function AddRequirement({ onDone }: { onDone: (itemId: string) => void }) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<ProductionItemKind>('prop')
  const [quantity, setQuantity] = useState(1)

  return (
    <div className="border-b border-line bg-panel-2/60 px-5 py-4">
      <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_130px_90px_minmax(220px,1.5fr)_auto]">
        <label className="text-[10px] uppercase tracking-wide text-ink-dim">Requirement name<input aria-label="Requirement name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
        <label className="text-[10px] uppercase tracking-wide text-ink-dim">Kind<select value={kind} onChange={(event) => setKind(event.target.value as ProductionItemKind)} className="mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case tracking-normal text-ink outline-none"><option value="character">Character</option><option value="prop">Prop</option><option value="background">Background</option></select></label>
        <label className="text-[10px] uppercase tracking-wide text-ink-dim">Quantity<input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case text-ink outline-none" /></label>
        <label className="text-[10px] uppercase tracking-wide text-ink-dim">Prompt<input aria-label="Requirement prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
        <button type="button" disabled={!name.trim()} onClick={() => { const current = useProjectStore.getState().workflow.production; const next = addProductionItem(current, { name, kind, provenance: 'explicit', quantity, sceneIds: [], prompt }); replaceProduction(next); onDone(next.items[next.items.length - 1].id) }} className="self-end rounded-md bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-40">Save requirement</button>
      </div>
    </div>
  )
}

type ProductionStage = 'requirements' | 'references' | 'models'

function ProductionInspector({ item, stage }: { item: ProductionItem; stage: ProductionStage }) {
  const workflow = useProjectStore((state) => state.workflow)
  const assets = useLibraryStore((state) => state.assets)
  const [libraryAssetId, setLibraryAssetId] = useState(item.fulfilledByAssetId ?? '')
  const [referenceLabel, setReferenceLabel] = useState('')
  const [referenceUri, setReferenceUri] = useState('')
  const [referenceRole, setReferenceRole] = useState<'primary' | 'variant'>(item.variantLabel ? 'variant' : 'primary')
  const [message, setMessage] = useState<string | null>(null)
  const modelAssets = assets.filter((asset) => asset.kind === 'model')
  const fulfillmentAssets = item.kind === 'background' ? assets : modelAssets
  const selectedLibraryAsset = assets.find((asset) => asset.id === libraryAssetId)
  const generationEligibility = productionGenerationEligibility(workflow.production, item)

  useEffect(() => {
    setLibraryAssetId(item.fulfilledByAssetId ?? '')
    setReferenceRole(item.variantLabel ? 'variant' : 'primary')
    setMessage(null)
  }, [item.id, item.fulfilledByAssetId, item.variantLabel])
  const update = (patch: Parameters<typeof updateProductionItem>[2]) => replaceProduction(updateProductionItem(useProjectStore.getState().workflow.production, item.id, patch))
  const approve = () => { const current = useProjectStore.getState().workflow; replaceProduction(approveProductionItems(current.production, [item.id], current.guidelines.skillId ?? 'project-guidelines-current')) }

  return (
    <aside className="min-h-0 overflow-y-auto border-t border-line bg-panel-2/35 p-4 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-medium uppercase tracking-wide text-ink-dim">Requirement details</p><StatusChip status={item.requirementStatus} /></div>
      <div hidden={stage !== 'requirements'}>
      <label className="mt-4 block text-[10px] uppercase tracking-wide text-ink-dim">Name<input value={item.name} onChange={(event) => update({ name: event.target.value })} className="mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[10px] uppercase tracking-wide text-ink-dim">Quantity<input type="number" min={1} value={item.quantity} onChange={(event) => update({ quantity: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case text-ink outline-none" /></label>
        {item.kind === 'background' && <label className="text-[10px] uppercase tracking-wide text-ink-dim">Background<select value={item.backgroundMode ?? '3d'} onChange={(event) => update({ backgroundMode: event.target.value as '3d' | 'flat' })} className="mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case text-ink outline-none"><option value="3d">Navigable 3D</option><option value="flat">Flat image</option></select></label>}
      </div>
      {item.kind === 'character' && <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[10px] uppercase tracking-wide text-ink-dim">Shared identity<input value={item.identityKey} onChange={(event) => update({ identityKey: event.target.value })} className="mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case text-ink outline-none" /></label><label className="text-[10px] uppercase tracking-wide text-ink-dim">Variant<input value={item.variantLabel ?? ''} onChange={(event) => update({ variantLabel: event.target.value || null })} placeholder="e.g. Evening wardrobe" className="mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case text-ink outline-none" /></label></div>}
      <label className="mt-3 block text-[10px] uppercase tracking-wide text-ink-dim">Effective prompt<textarea value={item.prompt} onChange={(event) => update({ prompt: event.target.value })} rows={3} className="mt-1 w-full resize-y rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
      <label className="mt-3 block text-[10px] uppercase tracking-wide text-ink-dim">Guideline exception<textarea value={item.guidelineException} onChange={(event) => update({ guidelineException: event.target.value })} rows={2} placeholder="Optional exception for this asset" className="mt-1 w-full resize-y rounded-md border border-line bg-panel px-2.5 py-2 text-xs normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>

      <div className="mt-4 border-t border-line pt-4">
        <div className="flex items-center justify-between"><p className="text-[10px] font-medium uppercase tracking-wide text-ink-dim">Scene assignments</p><span className="text-[10px] text-ink-dim">{item.sceneIds.length}</span></div>
        <div className="mt-2 flex flex-wrap gap-1.5">{workflow.production.scenes.length === 0 ? <span className="text-[11px] text-ink-dim">No proposed scenes</span> : workflow.production.scenes.map((scene) => <label key={scene.id} className={`cursor-pointer rounded-full border px-2 py-1 text-[10px] ${item.sceneIds.includes(scene.id) ? 'border-accent bg-accent/15 text-ink' : 'border-line text-ink-dim'}`}><input type="checkbox" className="sr-only" checked={item.sceneIds.includes(scene.id)} onChange={(event) => update({ sceneIds: event.target.checked ? [...item.sceneIds, scene.id] : item.sceneIds.filter((id) => id !== scene.id) })} />{scene.name}</label>)}</div>
      </div>
      {item.requirementStatus !== 'approved' && item.requirementStatus !== 'no-longer-required' && <button type="button" onClick={approve} className="mt-4 w-full rounded-md bg-accent px-3 py-2 text-xs font-medium text-white">Approve requirement and prompt</button>}

      </div>
      <div hidden={stage !== 'models'} className="mt-5 border-t border-line pt-4">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-dim">Library fulfillment</p>
        <select aria-label="Library asset" value={libraryAssetId} onChange={(event) => setLibraryAssetId(event.target.value)} className="mt-2 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs text-ink outline-none"><option value="">Choose an existing asset</option>{fulfillmentAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.kind}</option>)}</select>
        <AssetPreview asset={selectedLibraryAsset} />
        <button type="button" disabled={!libraryAssetId || item.requirementStatus !== 'approved'} onClick={() => { const result = fulfillProductionItem(useProjectStore.getState().workflow.production, item.id, libraryAssetId, 'existing'); if (result.ok) replaceProduction(result.list); else setMessage(result.error) }} className="mt-2 w-full rounded-md border border-line bg-panel px-3 py-2 text-xs text-ink hover:bg-panel-3 disabled:opacity-40">Use Library asset</button>
        <label className="mt-2 block cursor-pointer rounded-md border border-line bg-panel px-3 py-2 text-center text-xs text-ink hover:bg-panel-3">
          Import asset
          <input
            type="file"
            accept=".glb,.gltf,.obj,.ply,.splat"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.currentTarget.value = ''
              if (!file) return
              const projectId = useProjectStore.getState().projectId
              if (!projectId) return
              void importLibraryAsset(file, null, { navigate: false }).then(async (assetId) => {
                await listLibraryAssets()
                if (!assetId) return
                setLibraryAssetId(assetId)
                await updateProjectProduction(projectId, (list) => {
                  const result = fulfillProductionItem(list, item.id, assetId, 'imported')
                  if (!result.ok) setMessage(result.error)
                  return result.ok ? result.list : list
                })
              }).catch((error) => setMessage(error instanceof Error ? error.message : 'Import failed.'))
            }}
          />
        </label>
        {item.fulfilledByAssetId && <p className="mt-2 text-[11px] text-emerald-300">Fulfilled by {assets.find((asset) => asset.id === item.fulfilledByAssetId)?.name ?? item.fulfilledByAssetId}</p>}
        {item.fulfillmentHistory.length > 1 && (
          <p className="mt-1 text-[10px] text-ink-dim">{item.fulfillmentHistory.length} fulfillment links preserved</p>
        )}
      </div>

      <div hidden={stage !== 'references'} className="mt-5 border-t border-line pt-4">
        <p className="mb-3 text-xs leading-5 text-ink-dim">{item.prompt}</p>
        <div className="flex items-center justify-between"><p className="text-[10px] font-medium uppercase tracking-wide text-ink-dim">Reference versions</p><span className="text-[10px] text-ink-dim">{item.referenceVersions.length}</span></div>
        <input value={referenceLabel} onChange={(event) => setReferenceLabel(event.target.value)} placeholder="Reference name" aria-label="Reference name" className="mt-2 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs text-ink outline-none" />
        <input value={referenceUri} onChange={(event) => setReferenceUri(event.target.value)} placeholder="Reference URL or Library URI" aria-label="Reference location" className="mt-2 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs text-ink outline-none" />
        <select aria-label="Reference role" value={referenceRole} onChange={(event) => setReferenceRole(event.target.value as 'primary' | 'variant')} className="mt-2 w-full rounded-md border border-line bg-panel px-2.5 py-2 text-xs text-ink outline-none">
          <option value="primary">Primary identity</option>
          <option value="variant">Variant-specific</option>
        </select>
        <UploadProductionReference item={item} /><ProductionGenerationControls itemIds={[item.id]} stage="reference" />
        <button type="button" onClick={() => { const result = addReferenceVersion(useProjectStore.getState().workflow.production, item.id, { label: referenceLabel, uri: referenceUri, role: referenceRole }); if (result.ok) { replaceProduction(result.list); setReferenceLabel(''); setReferenceUri(''); setMessage(null) } else setMessage(result.error) }} className="mt-2 w-full rounded-md border border-line bg-panel px-3 py-2 text-xs text-ink hover:bg-panel-3">Add reference version</button>
        <div className="mt-2 space-y-1.5">{item.referenceVersions.map((reference) => <div key={reference.id} className="flex items-center justify-between gap-2 rounded-md bg-panel px-2 py-2 text-[11px]"><div className="min-w-0"><p className="truncate text-ink">{reference.label}</p><ProductionReferenceImage uri={reference.uri} label={reference.label} /><p className="mt-0.5 text-[9px] uppercase tracking-wide text-ink-dim">{reference.role} · prompt and guidelines saved</p><StatusChip status={reference.status} /></div>{!referenceMatchesCurrentInputs(item, reference) && <p className="text-amber-300">Inputs changed. Upload or generate a new reference.</p>}{reference.status !== 'approved' && <button type="button" disabled={!referenceMatchesCurrentInputs(item, reference)} onClick={() => replaceProduction(approveReferenceVersion(useProjectStore.getState().workflow.production, item.id, reference.id))} className="text-accent hover:underline disabled:opacity-40">Approve</button>}</div>)}</div>
      </div>

      <div hidden={stage !== 'models'} className="mt-5 border-t border-line pt-4">
        <div className="flex items-center justify-between"><p className="text-[10px] font-medium uppercase tracking-wide text-ink-dim">3D results</p><span className="text-[10px] text-ink-dim">{item.modelResults.length}</span></div>
        <p className="mt-1 text-[10px] leading-4 text-ink-dim">Generated models are saved to your Library. Review each result before approving it for this project.</p>
        <p className={`mt-2 text-[10px] ${generationEligibility.model ? 'text-emerald-300' : 'text-amber-300'}`}>
          {generationEligibility.model ? 'Ready for 3D generation' : generationEligibility.reason}
        </p>
        <ProductionGenerationControls itemIds={[item.id]} stage="model" />
        <div className="mt-2 space-y-1.5">{item.modelResults.map((result) => {
          const resultAsset = assets.find((asset) => asset.id === result.libraryAssetId)
          const matchesCurrentInputs = modelResultMatchesCurrentInputs(workflow.production, item, result)
          return <div key={result.id} className="rounded-md bg-panel px-2 py-2 text-[11px]"><div className="flex items-center justify-between gap-2"><span className="truncate text-ink">{resultAsset?.name ?? result.libraryAssetId}</span><StatusChip status={result.status} /></div><AssetPreview asset={resultAsset} /><p className="mt-1 text-[9px] text-ink-dim">{result.referenceVersionIds.length} reference input{result.referenceVersionIds.length === 1 ? '' : 's'} · prompt and guidelines saved</p>{result.status === 'needs-review' && <div className="mt-2 flex gap-3"><button type="button" disabled={!matchesCurrentInputs} onClick={() => replaceProduction(reviewModelResult(useProjectStore.getState().workflow.production, item.id, result.id, 'approved'))} className="text-accent hover:underline disabled:text-ink-dim">Approve</button><button type="button" onClick={() => replaceProduction(reviewModelResult(useProjectStore.getState().workflow.production, item.id, result.id, 'rejected'))} className="text-red-300 hover:underline">Reject</button></div>}{result.status === 'needs-review' && !matchesCurrentInputs && <p className="mt-1 text-[9px] text-amber-300">Inputs changed. Request a new result.</p>}{result.status === 'rejected' && <button type="button" disabled={!generationEligibility.model} onClick={() => setMessage('Use Generate 3D assets to confirm a new attempt. Your previous result remains in the Library.')} className="mt-2 text-accent hover:underline disabled:opacity-40">Request retry</button>}</div>
        })}</div>
        {item.generationRequests.length > 0 && <p className="mt-2 text-[10px] text-ink-dim">{item.generationRequests.length} generation request{item.generationRequests.length === 1 ? '' : 's'} recorded</p>}
      </div>
      {message && <p role="alert" className="mt-3 rounded-md bg-amber-500/10 px-2.5 py-2 text-[11px] leading-4 text-amber-300">{message}</p>}
      {item.requirementStatus !== 'no-longer-required' && <button type="button" onClick={() => replaceProduction(markProductionItemsNoLongerRequired(useProjectStore.getState().workflow.production, [item.id]))} className="mt-5 text-[11px] text-ink-dim hover:text-ink">Mark no longer required</button>}
      {item.requirementStatus === 'no-longer-required' && <button type="button" onClick={() => replaceProduction(restoreProductionItems(useProjectStore.getState().workflow.production, [item.id]))} className="mt-5 text-[11px] text-accent hover:underline">Restore requirement</button>}
      <p className="mt-2 text-[10px] leading-4 text-ink-dim">Assets are never deleted automatically. Remove assets manually from the Library.</p>
    </aside>
  )
}

export function ProductionListDialog() {
  const open = useEditorStore((state) => state.showProduction)
  const workflow = useProjectStore((state) => state.workflow)
  const projectName = useProjectStore((state) => state.name)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<'active' | 'needs-review' | 'approved' | 'retired'>('active')
  const [stage, setStage] = useState<ProductionStage>('requirements')
  const [query, setQuery] = useState('')
  const visibleItems = useMemo(() => { const needle = query.trim().toLowerCase(); return workflow.production.items.filter((item) => { const matchesFilter = filter === 'active' ? item.requirementStatus !== 'no-longer-required' : filter === 'retired' ? item.requirementStatus === 'no-longer-required' : item.requirementStatus === filter; return matchesFilter && (!needle || item.name.toLowerCase().includes(needle)) }) }, [filter, query, workflow.production.items])
  const selectedItem = workflow.production.items.find((item) => item.id === selectedItemId) ?? null

  useEffect(() => {
    if (open && typeof indexedDB !== 'undefined') void listLibraryAssets()
  }, [open])
  useEffect(() => { if (!open) { setSelectedIds([]); setSelectedItemId(null); setAdding(false) } }, [open])
  if (!open) return null
  const approveSelected = () => { if (!selectedIds.length) return; const current = useProjectStore.getState().workflow; replaceProduction(approveProductionItems(current.production, selectedIds, current.guidelines.skillId ?? 'project-guidelines-current')); setSelectedIds([]) }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) useEditorStore.getState().setShowProduction(false) }}>
      <section role="dialog" aria-modal="true" aria-labelledby="production-list-title" className="panel flex h-[min(820px,92vh)] w-[min(1180px,96vw)] flex-col overflow-hidden">
        <header className="flex items-start justify-between border-b border-line/60 px-5 py-4"><div><h2 id="production-list-title" className="text-sm font-semibold text-ink">Production list</h2><p className="mt-1 text-[11px] text-ink-dim">{projectName} · Requirements, references, and approved assets</p></div><button type="button" title="Close production list" onClick={() => useEditorStore.getState().setShowProduction(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-dim hover:bg-panel-2 hover:text-ink">×</button></header>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 px-5 py-3"><nav aria-label="Production steps" className="flex items-center gap-2 text-[11px] text-ink-dim">{(['requirements', 'references', 'models'] as const).map((step, index) => <button key={step} type="button" aria-current={stage === step ? 'step' : undefined} onClick={() => { setStage(step); setAdding(false); if (!selectedItemId) setSelectedItemId(visibleItems[0]?.id ?? null) }} className={`rounded-full px-2.5 py-1 font-medium ${stage === step ? 'bg-accent text-white' : 'bg-panel-2 hover:text-ink'}`}>{index + 1} {step === 'requirements' ? 'Requirements' : step === 'references' ? 'References' : '3D review'}</button>)}</nav>{stage === 'requirements' && <div className="flex items-center gap-2"><button type="button" onClick={() => setAdding((value) => !value)} className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink hover:bg-panel-3">Add requirement</button><button type="button" disabled={!selectedIds.length} onClick={approveSelected} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">Approve selected</button></div>}</div>
        {selectedIds.length > 0 && stage !== 'requirements' && <div className="flex flex-wrap gap-3 border-b border-line px-5 py-3"><ProductionGenerationControls itemIds={selectedIds} stage={stage === 'references' ? 'reference' : 'model'} compact /></div>}
        {adding && <AddRequirement onDone={(itemId) => { setAdding(false); setSelectedItemId(itemId) }} />}
        {(workflow.production.lastDiff.addedItemIds.length > 0 || workflow.production.lastDiff.changedItemIds.length > 0 || workflow.production.lastDiff.removedItemIds.length > 0) && <div role="status" className="flex items-center justify-between gap-3 border-b border-line bg-accent/10 px-5 py-2 text-[11px] text-ink"><span>Breakdown changes: {workflow.production.lastDiff.addedItemIds.length} added · {workflow.production.lastDiff.changedItemIds.length} changed · {workflow.production.lastDiff.removedItemIds.length} no longer required</span><button type="button" onClick={() => replaceProduction(acknowledgeProductionDiff(useProjectStore.getState().workflow.production))} className="text-accent hover:underline">Dismiss</button></div>}
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-0 overflow-auto p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex gap-1">{(['active', 'needs-review', 'approved', 'retired'] as const).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-2.5 py-1 text-[10px] ${filter === value ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:text-ink'}`}>{value === 'active' ? 'Active' : value === 'retired' ? 'No longer required' : STATUS_LABEL[value]}</button>)}</div><input type="search" aria-label="Search production list" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requirements" className="w-52 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent" /></div>
            {visibleItems.length === 0 ? <div className="rounded-lg border border-dashed border-line p-8 text-center"><p className="text-sm text-ink">No production requirements here</p><p className="mt-1 text-xs text-ink-dim">Add requirements manually or apply a reviewed script breakdown.</p></div> : <div className="overflow-x-auto rounded-lg border border-line"><div className="min-w-[650px]"><div className="grid grid-cols-[40px_minmax(160px,1.4fr)_80px_70px_90px_minmax(110px,1fr)] gap-2 border-b border-line bg-panel-2 px-3 py-2 text-[10px] uppercase tracking-wide text-ink-dim"><span /><span>Requirement</span><span>Kind</span><span>Qty</span><span>Source</span><span>Status</span></div>{visibleItems.map((item) => <div key={item.id} className={`grid grid-cols-[40px_minmax(160px,1.4fr)_80px_70px_90px_minmax(110px,1fr)] items-center gap-2 border-b border-line/60 px-3 py-3 text-xs last:border-b-0 ${selectedItemId === item.id ? 'bg-accent/10' : 'hover:bg-panel-2/50'}`}><input type="checkbox" aria-label={`Select ${item.name}`} checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="h-4 w-4 accent-accent" /><button type="button" onClick={() => setSelectedItemId(item.id)} className="truncate text-left font-medium text-ink">{item.name}</button><span className="capitalize text-ink-dim">{item.kind}</span><span className="text-ink-dim">{item.quantity}</span><span className="text-ink-dim">{item.provenance === 'suggested' ? 'Suggested' : 'Script'}</span><StatusChip status={item.requirementStatus} /></div>)}</div></div>}
          </div>
          {selectedItem ? <ProductionInspector key={selectedItem.id} item={selectedItem} stage={stage} /> : <aside className="flex items-center justify-center border-t border-line bg-panel-2/25 p-6 text-center lg:border-l lg:border-t-0"><div><p className="text-xs text-ink">Select a requirement</p><p className="mt-1 text-[11px] leading-5 text-ink-dim">Edit its prompt, assign scenes, approve references, or link an asset from the Library.</p></div></aside>}
        </div>
        <footer className="flex items-center justify-between border-t border-line px-5 py-3"><button type="button" onClick={() => useEditorStore.getState().setShowProduction(false)} className="rounded-md border border-line px-3 py-2 text-xs text-ink">Open workspace</button><p className="text-xs text-ink-dim">{workflow.production.items.filter((item) => item.fulfilledByAssetId).length} of {workflow.production.items.filter((item) => item.requirementStatus !== 'no-longer-required').length} assets linked</p>{stage !== 'models' && <button type="button" className="rounded-md bg-accent px-3 py-2 text-xs text-white" onClick={() => { setStage(stage === 'requirements' ? 'references' : 'models'); if (!selectedItemId) setSelectedItemId(visibleItems[0]?.id ?? null) }}>{stage === 'requirements' ? 'Continue to references' : 'Continue to 3D review'}</button>}</footer>
      </section>
    </div>
  )
}
