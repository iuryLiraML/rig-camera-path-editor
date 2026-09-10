export type ProductionItemKind = 'character' | 'prop' | 'background'
export type ProductionProvenance = 'explicit' | 'suggested'
export type RequirementStatus = 'needs-review' | 'approved' | 'no-longer-required'
export type ReviewStatus = 'needs-review' | 'approved' | 'rejected'
export type BackgroundMode = '3d' | 'flat'
export type FulfillmentMethod = 'existing' | 'imported' | 'generated'

export interface ProposedScene {
  id: string
  sourceKeys: string[]
  name: string
  manuallyStructured: boolean
}

export type ReferenceRole = 'primary' | 'variant'

export interface ReferenceVersion {
  id: string
  label: string
  uri: string
  role: ReferenceRole
  status: ReviewStatus
  createdAt: string
  approvedAt: string | null
  prompt: string
  guidelineVersionId: string | null
  guidelineException: string
}

export interface GenerationInputs {
  prompt: string
  guidelineVersionId: string | null
  guidelineException: string
  referenceVersionIds: string[]
}

export interface ModelResult extends GenerationInputs {
  id: string
  libraryAssetId: string
  status: ReviewStatus
  createdAt: string
  reviewedAt: string | null
}

export interface FulfillmentLink {
  libraryAssetId: string
  method: FulfillmentMethod
  linkedAt: string
  modelResultId: string | null
}

export interface GenerationRequest extends GenerationInputs {
  id: string
  stage: 'reference' | 'model'
  createdAt: string
  retryOfResultId: string | null
}

export type ProductionEditableField =
  | 'name'
  | 'quantity'
  | 'sceneIds'
  | 'prompt'
  | 'guidelineException'
  | 'backgroundMode'
  | 'variantLabel'
  | 'identityKey'

export interface ProductionItem {
  id: string
  sourceKey: string
  sourceFingerprint: string
  name: string
  kind: ProductionItemKind
  provenance: ProductionProvenance
  quantity: number
  sceneIds: string[]
  identityKey: string
  variantLabel: string | null
  backgroundMode: BackgroundMode | null
  requirementStatus: RequirementStatus
  prompt: string
  promptStatus: 'needs-review' | 'approved'
  guidelineVersionId: string | null
  guidelineException: string
  approvedAt: string | null
  manualFields: ProductionEditableField[]
  referenceVersions: ReferenceVersion[]
  activeReferenceVersionIds: string[]
  modelResults: ModelResult[]
  fulfilledByAssetId: string | null
  fulfillmentMethod: FulfillmentMethod | null
  fulfilledByResultId: string | null
  fulfillmentHistory: FulfillmentLink[]
  generationRequests: GenerationRequest[]
}

export interface ProductionDiff {
  addedItemIds: string[]
  changedItemIds: string[]
  removedItemIds: string[]
}

export interface ProductionList {
  sourceRevisionId: string | null
  scenes: ProposedScene[]
  items: ProductionItem[]
  lastDiff: ProductionDiff
}

export interface ProductionProposalScene {
  sourceKey: string
  name: string
}

export interface ProductionProposalItem {
  sourceKey: string
  sourceFingerprint: string
  name: string
  kind: ProductionItemKind
  provenance: ProductionProvenance
  quantity: number
  sceneSourceKeys: string[]
  prompt: string
  identityKey?: string
  variantLabel?: string | null
  backgroundMode?: BackgroundMode | null
}

export interface ProductionProposal {
  revisionId: string
  scenes: ProductionProposalScene[]
  items: ProductionProposalItem[]
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

export function createProductionList(): ProductionList {
  return {
    sourceRevisionId: null,
    scenes: [],
    items: [],
    lastDiff: { addedItemIds: [], changedItemIds: [], removedItemIds: [] },
  }
}

export function acknowledgeProductionDiff(list: ProductionList): ProductionList {
  return { ...list, lastDiff: { addedItemIds: [], changedItemIds: [], removedItemIds: [] } }
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** Runtime boundary for production data restored from IndexedDB or the cloud. */
export function migrateProductionList(value: unknown): ProductionList {
  if (typeof value !== 'object' || value === null) return createProductionList()
  const candidate = value as Partial<ProductionList>
  const scenes = Array.isArray(candidate.scenes)
    ? candidate.scenes.flatMap((scene) => {
        if (typeof scene !== 'object' || scene === null) return []
        const entry = scene as Partial<ProposedScene> & { sourceKey?: unknown }
        const sourceKeys = stringArray(entry.sourceKeys)
        if (sourceKeys.length === 0 && typeof entry.sourceKey === 'string') sourceKeys.push(entry.sourceKey)
        return typeof entry.id === 'string' && typeof entry.name === 'string'
          ? [{ id: entry.id, sourceKeys, name: entry.name, manuallyStructured: entry.manuallyStructured === true }]
          : []
      })
    : []
  const items = Array.isArray(candidate.items)
    ? candidate.items.flatMap((item) => {
        if (typeof item !== 'object' || item === null) return []
        const entry = item as Partial<ProductionItem>
        if (
          typeof entry.id !== 'string' ||
          typeof entry.sourceKey !== 'string' ||
          typeof entry.name !== 'string' ||
          (entry.kind !== 'character' && entry.kind !== 'prop' && entry.kind !== 'background')
        ) return []
        const requirementStatus: RequirementStatus = entry.requirementStatus === 'approved' || entry.requirementStatus === 'no-longer-required'
          ? entry.requirementStatus
          : 'needs-review'
        const referenceVersions = Array.isArray(entry.referenceVersions)
          ? entry.referenceVersions.filter((version) => Boolean(
              version && typeof version.id === 'string' && typeof version.label === 'string' &&
              typeof version.uri === 'string' && typeof version.createdAt === 'string' &&
              (version.status === 'needs-review' || version.status === 'approved' || version.status === 'rejected'),
            )).map((version) => ({
              ...version,
              role: version.role === 'variant' ? 'variant' as const : 'primary' as const,
              prompt: typeof version.prompt === 'string' ? version.prompt : '',
              guidelineVersionId: typeof version.guidelineVersionId === 'string' ? version.guidelineVersionId : null,
              guidelineException: typeof version.guidelineException === 'string' ? version.guidelineException : '',
            }) as ReferenceVersion)
          : []
        const modelResults = Array.isArray(entry.modelResults)
          ? entry.modelResults.filter((result) => Boolean(
              result && typeof result.id === 'string' && typeof result.libraryAssetId === 'string' &&
              typeof result.createdAt === 'string' &&
              (result.status === 'needs-review' || result.status === 'approved' || result.status === 'rejected'),
            )).map((result) => ({
              ...result,
              prompt: typeof result.prompt === 'string' ? result.prompt : '',
              guidelineVersionId: typeof result.guidelineVersionId === 'string' ? result.guidelineVersionId : null,
              guidelineException: typeof result.guidelineException === 'string' ? result.guidelineException : '',
              referenceVersionIds: stringArray(result.referenceVersionIds).length > 0
                ? stringArray(result.referenceVersionIds)
                : typeof (result as unknown as { referenceVersionId?: unknown }).referenceVersionId === 'string'
                  ? [(result as unknown as { referenceVersionId: string }).referenceVersionId]
                  : [],
            }) as ModelResult)
          : []
        const fulfilledByAssetId = typeof entry.fulfilledByAssetId === 'string' ? entry.fulfilledByAssetId : null
        const fulfillmentMethod = entry.fulfillmentMethod === 'existing' || entry.fulfillmentMethod === 'imported' || entry.fulfillmentMethod === 'generated'
          ? entry.fulfillmentMethod
          : null
        const fulfillmentHistory = Array.isArray(entry.fulfillmentHistory)
          ? entry.fulfillmentHistory.filter((link) => Boolean(
              link && typeof link.libraryAssetId === 'string' && typeof link.linkedAt === 'string' &&
              (link.method === 'existing' || link.method === 'imported' || link.method === 'generated'),
            )).map((link) => ({
              ...link,
              modelResultId: typeof link.modelResultId === 'string' ? link.modelResultId : null,
            }) as FulfillmentLink)
          : fulfilledByAssetId && fulfillmentMethod
            ? [{ libraryAssetId: fulfilledByAssetId, method: fulfillmentMethod, linkedAt: '', modelResultId: null }]
            : []
        const generationRequests = Array.isArray(entry.generationRequests)
          ? entry.generationRequests.filter((request): request is GenerationRequest => Boolean(
              request && typeof request.id === 'string' && typeof request.createdAt === 'string' &&
              (request.stage === 'reference' || request.stage === 'model'),
            )).map((request) => ({
              ...request,
              prompt: typeof request.prompt === 'string' ? request.prompt : '',
              guidelineVersionId: typeof request.guidelineVersionId === 'string' ? request.guidelineVersionId : null,
              guidelineException: typeof request.guidelineException === 'string' ? request.guidelineException : '',
              referenceVersionIds: stringArray(request.referenceVersionIds),
              retryOfResultId: typeof request.retryOfResultId === 'string' ? request.retryOfResultId : null,
            }))
          : []
        return [{
          id: entry.id,
          sourceKey: entry.sourceKey,
          sourceFingerprint: typeof entry.sourceFingerprint === 'string' ? entry.sourceFingerprint : entry.sourceKey,
          name: entry.name,
          kind: entry.kind,
          provenance: entry.provenance === 'suggested' ? 'suggested' as const : 'explicit' as const,
          quantity: typeof entry.quantity === 'number' && entry.quantity > 0 ? Math.round(entry.quantity) : 1,
          sceneIds: stringArray(entry.sceneIds),
          identityKey: typeof entry.identityKey === 'string' ? entry.identityKey : entry.sourceKey,
          variantLabel: typeof entry.variantLabel === 'string' ? entry.variantLabel : null,
          backgroundMode: entry.kind === 'background' && entry.backgroundMode === 'flat' ? 'flat' as const : entry.kind === 'background' ? '3d' as const : null,
          requirementStatus,
          prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
          promptStatus: entry.promptStatus === 'approved' ? 'approved' as const : 'needs-review' as const,
          guidelineVersionId: typeof entry.guidelineVersionId === 'string' ? entry.guidelineVersionId : null,
          guidelineException: typeof entry.guidelineException === 'string' ? entry.guidelineException : '',
          approvedAt: typeof entry.approvedAt === 'string' ? entry.approvedAt : null,
          manualFields: stringArray(entry.manualFields).filter((field): field is ProductionEditableField =>
            ['name', 'quantity', 'sceneIds', 'prompt', 'guidelineException', 'backgroundMode', 'variantLabel', 'identityKey'].includes(field),
          ),
          referenceVersions,
          activeReferenceVersionIds: stringArray(entry.activeReferenceVersionIds).length > 0
            ? stringArray(entry.activeReferenceVersionIds)
            : typeof (entry as { activeReferenceVersionId?: unknown }).activeReferenceVersionId === 'string'
              ? [(entry as { activeReferenceVersionId: string }).activeReferenceVersionId]
              : [],
          modelResults,
          fulfilledByAssetId,
          fulfillmentMethod,
          fulfilledByResultId: typeof entry.fulfilledByResultId === 'string' ? entry.fulfilledByResultId : null,
          fulfillmentHistory,
          generationRequests,
        }]
      })
    : []
  const rawDiff = candidate.lastDiff
  const lastDiff = typeof rawDiff === 'object' && rawDiff !== null
    ? {
        addedItemIds: stringArray(rawDiff.addedItemIds),
        changedItemIds: stringArray(rawDiff.changedItemIds),
        removedItemIds: stringArray(rawDiff.removedItemIds),
      }
    : createProductionList().lastDiff
  return {
    sourceRevisionId: typeof candidate.sourceRevisionId === 'string' ? candidate.sourceRevisionId : null,
    scenes,
    items,
    lastDiff,
  }
}

function proposalSceneIds(
  sourceKeys: string[],
  scenesBySourceKey: Map<string, ProposedScene[]>,
) {
  return unique(
    sourceKeys
      .flatMap((sourceKey) => scenesBySourceKey.get(sourceKey)?.map((scene) => scene.id) ?? []),
  )
}

function newItem(
  proposal: ProductionProposalItem,
  sceneIds: string[],
): ProductionItem {
  return {
    id: makeId('production-item'),
    sourceKey: proposal.sourceKey,
    sourceFingerprint: proposal.sourceFingerprint,
    name: proposal.name.trim() || 'Untitled requirement',
    kind: proposal.kind,
    provenance: proposal.provenance,
    quantity: Math.max(1, Math.round(proposal.quantity) || 1),
    sceneIds,
    identityKey: proposal.identityKey?.trim() || proposal.sourceKey,
    variantLabel: proposal.variantLabel?.trim() || null,
    backgroundMode: proposal.kind === 'background' ? (proposal.backgroundMode ?? '3d') : null,
    requirementStatus: 'needs-review',
    prompt: proposal.prompt.trim(),
    promptStatus: 'needs-review',
    guidelineVersionId: null,
    guidelineException: '',
    approvedAt: null,
    manualFields: [],
    referenceVersions: [],
    activeReferenceVersionIds: [],
    modelResults: [],
    fulfilledByAssetId: null,
    fulfillmentMethod: null,
    fulfilledByResultId: null,
    fulfillmentHistory: [],
    generationRequests: [],
  }
}

function preserveManual<T extends keyof ProductionItem>(
  item: ProductionItem,
  field: T,
  proposed: ProductionItem[T],
): ProductionItem[T] {
  return item.manualFields.includes(field as ProductionEditableField) ? item[field] : proposed
}

export function reconcileProductionList(
  current: ProductionList,
  proposal: ProductionProposal,
): { list: ProductionList; diff: ProductionDiff } {
  const proposedSourceKeys = new Set(proposal.scenes.map((scene) => scene.sourceKey))
  const manualScenes = current.scenes.filter((scene) =>
    scene.manuallyStructured && (scene.sourceKeys.length === 0 || scene.sourceKeys.some((key) => proposedSourceKeys.has(key))),
  )
  const coveredSourceKeys = new Set(manualScenes.flatMap((scene) => scene.sourceKeys))
  const sourceScenes = proposal.scenes.flatMap((scene) => {
    if (coveredSourceKeys.has(scene.sourceKey)) return []
    const existing = current.scenes.find((candidate) =>
      !candidate.manuallyStructured && candidate.sourceKeys.length === 1 && candidate.sourceKeys[0] === scene.sourceKey,
    )
    return [{
      id: existing?.id ?? makeId('proposed-scene'),
      sourceKeys: [scene.sourceKey],
      name: existing?.name ?? (scene.name.trim() || 'Untitled scene'),
      manuallyStructured: false,
    }]
  })
  const scenes = [...sourceScenes, ...manualScenes]
  const scenesBySourceKey = new Map<string, ProposedScene[]>()
  for (const scene of scenes) {
    for (const sourceKey of scene.sourceKeys) {
      scenesBySourceKey.set(sourceKey, [...(scenesBySourceKey.get(sourceKey) ?? []), scene])
    }
  }
  const existingItems = new Map(current.items.map((item) => [item.sourceKey, item]))
  const seen = new Set<string>()
  const addedItemIds: string[] = []
  const changedItemIds: string[] = []

  const items = proposal.items.map((candidate) => {
    seen.add(candidate.sourceKey)
    const existing = existingItems.get(candidate.sourceKey)
    const sceneIds = proposalSceneIds(candidate.sceneSourceKeys, scenesBySourceKey)
    if (!existing) {
      const item = newItem(candidate, sceneIds)
      addedItemIds.push(item.id)
      return item
    }

    const changed = existing.sourceFingerprint !== candidate.sourceFingerprint
    if (changed) changedItemIds.push(existing.id)
    return {
      ...existing,
      sourceFingerprint: candidate.sourceFingerprint,
      name: preserveManual(existing, 'name', candidate.name.trim() || 'Untitled requirement'),
      quantity: preserveManual(existing, 'quantity', Math.max(1, Math.round(candidate.quantity) || 1)),
      sceneIds: preserveManual(existing, 'sceneIds', sceneIds).filter((id) => scenes.some((scene) => scene.id === id)),
      prompt: preserveManual(existing, 'prompt', candidate.prompt.trim()),
      identityKey: preserveManual(existing, 'identityKey', candidate.identityKey?.trim() || existing.identityKey),
      variantLabel: preserveManual(existing, 'variantLabel', candidate.variantLabel?.trim() || null),
      backgroundMode: preserveManual(
        existing,
        'backgroundMode',
        candidate.kind === 'background' ? (candidate.backgroundMode ?? '3d') : null,
      ),
      kind: candidate.kind,
      provenance: candidate.provenance,
      requirementStatus: changed || existing.requirementStatus === 'no-longer-required'
        ? 'needs-review' as const
        : existing.requirementStatus,
      promptStatus: changed ? 'needs-review' as const : existing.promptStatus,
      approvedAt: changed ? null : existing.approvedAt,
    }
  })

  const removed = current.items
    .filter((item) => !seen.has(item.sourceKey))
    .map((item) => ({ ...item, requirementStatus: 'no-longer-required' as const }))
  const removedItemIds = removed
    .filter((item) => current.items.find((currentItem) => currentItem.id === item.id)?.requirementStatus !== 'no-longer-required')
    .map((item) => item.id)
  const diff = { addedItemIds, changedItemIds, removedItemIds }
  const list = { sourceRevisionId: proposal.revisionId, scenes, items: [...items, ...removed], lastDiff: diff }
  return { list, diff }
}

export function updateProductionItem(
  list: ProductionList,
  itemId: string,
  patch: Partial<Pick<ProductionItem, ProductionEditableField>>,
): ProductionList {
  const fields = Object.keys(patch) as ProductionEditableField[]
  return {
    ...list,
    items: list.items.map((item) => item.id === itemId
      ? {
          ...item,
          ...patch,
          quantity: patch.quantity === undefined ? item.quantity : Math.max(1, Math.round(patch.quantity) || 1),
          manualFields: unique([...item.manualFields, ...fields]),
          requirementStatus: item.requirementStatus === 'no-longer-required' ? item.requirementStatus : 'needs-review',
          promptStatus: patch.prompt === undefined && patch.guidelineException === undefined
            ? item.promptStatus
            : 'needs-review',
          approvedAt: null,
        }
      : item),
  }
}

export function approveProductionItems(
  list: ProductionList,
  itemIds: string[],
  guidelineVersionId: string,
  approvedAt = new Date().toISOString(),
): ProductionList {
  const selected = new Set(itemIds)
  return {
    ...list,
    items: list.items.map((item) => selected.has(item.id) && item.requirementStatus !== 'no-longer-required'
      ? {
          ...item,
          requirementStatus: 'approved',
          promptStatus: 'approved',
          guidelineVersionId,
          approvedAt,
        }
      : item),
  }
}

export type ProductionActionResult =
  | { ok: true; list: ProductionList }
  | { ok: false; error: string }

export interface GenerationEligibility {
  reference: boolean
  model: boolean
  reason: string | null
}

function itemById(list: ProductionList, itemId: string) {
  return list.items.find((item) => item.id === itemId)
}

export function activeReferencesForItem(list: ProductionList, item: ProductionItem): ReferenceVersion[] {
  const ownActive = item.referenceVersions.filter(
    (reference) => item.activeReferenceVersionIds.includes(reference.id) && reference.status === 'approved' && referenceMatchesCurrentInputs(item, reference),
  )
  const primary = ownActive.find((reference) => reference.role === 'primary') ?? list.items
    .filter((candidate) => candidate.kind === 'character' && candidate.identityKey === item.identityKey)
    .flatMap((candidate) => candidate.referenceVersions.filter(
      (reference) => candidate.activeReferenceVersionIds.includes(reference.id) &&
        reference.status === 'approved' && reference.role === 'primary' && referenceMatchesCurrentInputs(candidate, reference),
    ))[0]
  const variants = ownActive.filter((reference) => reference.role === 'variant')
  return primary ? [primary, ...variants] : variants
}

export function referenceMatchesCurrentInputs(item: ProductionItem, reference: ReferenceVersion): boolean {
  return item.requirementStatus === 'approved' && item.promptStatus === 'approved' &&
    reference.prompt === item.prompt && reference.guidelineVersionId === item.guidelineVersionId &&
    reference.guidelineException === item.guidelineException
}

export function productionGenerationEligibility(list: ProductionList, item: ProductionItem): GenerationEligibility {
  if (item.requirementStatus !== 'approved' || item.promptStatus !== 'approved') {
    return { reference: false, model: false, reason: 'Approve the current requirement and prompt.' }
  }
  const hasApprovedReference = activeReferencesForItem(list, item).length > 0
  if (!hasApprovedReference) {
    return { reference: true, model: false, reason: 'Approve a reference before 3D generation.' }
  }
  return { reference: true, model: true, reason: null }
}

function generationInputs(list: ProductionList, item: ProductionItem): GenerationInputs {
  return {
    prompt: item.prompt,
    guidelineVersionId: item.guidelineVersionId,
    guidelineException: item.guidelineException,
    referenceVersionIds: activeReferencesForItem(list, item).map((reference) => reference.id),
  }
}

function appendFulfillmentLink(
  history: FulfillmentLink[],
  libraryAssetId: string,
  method: FulfillmentMethod,
  linkedAt: string,
  modelResultId: string | null,
): FulfillmentLink[] {
  const latest = history[history.length - 1]
  if (latest?.libraryAssetId === libraryAssetId && latest.method === method && latest.modelResultId === modelResultId) return history
  return [...history, { libraryAssetId, method, linkedAt, modelResultId }]
}

export function modelResultMatchesCurrentInputs(
  list: ProductionList,
  item: ProductionItem,
  result: ModelResult,
): boolean {
  if (item.requirementStatus !== 'approved' || item.promptStatus !== 'approved') return false
  const current = generationInputs(list, item)
  const currentReferenceIds = [...current.referenceVersionIds].sort()
  const resultReferenceIds = [...result.referenceVersionIds].sort()
  return result.prompt === current.prompt &&
    result.guidelineVersionId === current.guidelineVersionId &&
    result.guidelineException === current.guidelineException &&
    currentReferenceIds.length === resultReferenceIds.length &&
    currentReferenceIds.every((id, index) => id === resultReferenceIds[index])
}

export function requestProductionGeneration(
  list: ProductionList,
  itemId: string,
  stage: GenerationRequest['stage'],
  options: { retryOfResultId?: string | null; createdAt?: string } = {},
): ProductionActionResult {
  const item = itemById(list, itemId)
  if (!item) return { ok: false, error: 'Production item not found.' }
  const eligibility = productionGenerationEligibility(list, item)
  if (stage === 'reference' && !eligibility.reference) {
    return { ok: false, error: 'Approve the current requirement and prompt before requesting references.' }
  }
  if (stage === 'model' && !eligibility.model) {
    return { ok: false, error: eligibility.reason ?? 'Approve the production inputs before requesting 3D.' }
  }
  const retryOfResultId = options.retryOfResultId ?? null
  if (retryOfResultId && !item.modelResults.some((result) => result.id === retryOfResultId && result.status === 'rejected')) {
    return { ok: false, error: 'Only a rejected 3D result can be retried.' }
  }
  const request: GenerationRequest = {
    id: makeId('generation-request'),
    stage,
    createdAt: options.createdAt ?? new Date().toISOString(),
    ...generationInputs(list, item),
    retryOfResultId,
  }
  if (stage === 'reference') request.referenceVersionIds = []
  return {
    ok: true,
    list: {
      ...list,
      items: list.items.map((candidate) => candidate.id === itemId
        ? { ...candidate, generationRequests: [...candidate.generationRequests, request] }
        : candidate),
    },
  }
}

export function addReferenceVersion(
  list: ProductionList,
  itemId: string,
  input: { label: string; uri: string; role?: ReferenceRole },
  createdAt = new Date().toISOString(),
): ProductionActionResult {
  const item = itemById(list, itemId)
  if (!item) return { ok: false, error: 'Production item not found.' }
  if (!productionGenerationEligibility(list, item).reference) {
    return { ok: false, error: 'Approve the requirement and prompt before adding references.' }
  }
  const label = input.label.trim()
  const uri = input.uri.trim()
  if (!label || !uri) return { ok: false, error: 'Reference name and location are required.' }
  const version: ReferenceVersion = {
    id: makeId('reference'),
    label,
    uri,
    role: input.role ?? 'primary',
    status: 'needs-review',
    createdAt,
    approvedAt: null,
    prompt: item.prompt,
    guidelineVersionId: item.guidelineVersionId,
    guidelineException: item.guidelineException,
  }
  return {
    ok: true,
    list: {
      ...list,
      items: list.items.map((entry) => entry.id === itemId
        ? { ...entry, referenceVersions: [...entry.referenceVersions, version] }
        : entry),
    },
  }
}

export function approveReferenceVersion(
  list: ProductionList,
  itemId: string,
  referenceId: string,
  approvedAt = new Date().toISOString(),
): ProductionList {
  const owner = itemById(list, itemId)
  const approvedReference = owner?.referenceVersions.find((version) => version.id === referenceId)
  if (!owner || !approvedReference) return list
  if (!referenceMatchesCurrentInputs(owner, approvedReference)) return list
  const identityWidePrimary = owner.kind === 'character' && approvedReference.role === 'primary'
  return {
    ...list,
    items: list.items.map((item) => {
      const sharesIdentity = identityWidePrimary && item.kind === 'character' && item.identityKey === owner.identityKey
      if (item.id !== itemId && !sharesIdentity) return item
      const withoutReplacedRole = item.activeReferenceVersionIds.filter((id) => {
        const active = item.referenceVersions.find((version) => version.id === id)
        return active?.role !== approvedReference.role
      })
      if (item.id !== itemId) return { ...item, activeReferenceVersionIds: withoutReplacedRole }
      return {
        ...item,
        activeReferenceVersionIds: unique([...withoutReplacedRole, referenceId]),
        referenceVersions: item.referenceVersions.map((version) => version.id === referenceId
          ? { ...version, status: 'approved' as const, approvedAt }
          : version),
      }
    }),
  }
}

export function addModelResult(
  list: ProductionList,
  itemId: string,
  libraryAssetId: string,
  createdAt = new Date().toISOString(),
): ProductionActionResult {
  const item = itemById(list, itemId)
  if (!item) return { ok: false, error: 'Production item not found.' }
  if (!productionGenerationEligibility(list, item).reference) {
    return { ok: false, error: 'Approve the current requirement and prompt before adding a 3D result.' }
  }
  const activeReferences = activeReferencesForItem(list, item)
  if (activeReferences.length === 0) return { ok: false, error: 'Approve a reference before adding a 3D result.' }
  if (!libraryAssetId.trim()) return { ok: false, error: 'Choose a Library model.' }
  const result: ModelResult = {
    id: makeId('model-result'),
    libraryAssetId,
    status: 'needs-review',
    createdAt,
    reviewedAt: null,
    ...generationInputs(list, item),
  }
  return {
    ok: true,
    list: {
      ...list,
      items: list.items.map((entry) => entry.id === itemId
        ? { ...entry, modelResults: [...entry.modelResults, result] }
        : entry),
    },
  }
}

export function reviewModelResult(
  list: ProductionList,
  itemId: string,
  resultId: string,
  status: 'approved' | 'rejected',
  reviewedAt = new Date().toISOString(),
): ProductionList {
  return {
    ...list,
    items: list.items.map((item) => {
      if (item.id !== itemId) return item
      const result = item.modelResults.find((entry) => entry.id === resultId)
      if (!result) return item
      if (status === 'approved' && !modelResultMatchesCurrentInputs(list, item, result)) return item
      const unfulfillRejected = status === 'rejected' && item.fulfilledByResultId === result.id
      const fulfillmentHistory = status === 'approved'
        ? appendFulfillmentLink(item.fulfillmentHistory, result.libraryAssetId, 'generated', reviewedAt, result.id)
        : item.fulfillmentHistory
      return {
        ...item,
        modelResults: item.modelResults.map((entry) => entry.id === resultId
          ? { ...entry, status, reviewedAt }
          : entry),
        fulfilledByAssetId: status === 'approved'
          ? result.libraryAssetId
          : unfulfillRejected ? null : item.fulfilledByAssetId,
        fulfillmentMethod: status === 'approved'
          ? 'generated'
          : unfulfillRejected ? null : item.fulfillmentMethod,
        fulfilledByResultId: status === 'approved'
          ? result.id
          : unfulfillRejected ? null : item.fulfilledByResultId,
        fulfillmentHistory,
      }
    }),
  }
}

export function fulfillProductionItem(
  list: ProductionList,
  itemId: string,
  libraryAssetId: string,
  method: Extract<FulfillmentMethod, 'existing' | 'imported'>,
  linkedAt = new Date().toISOString(),
): ProductionActionResult {
  const item = itemById(list, itemId)
  if (!item) return { ok: false, error: 'Production item not found.' }
  if (item.requirementStatus !== 'approved') {
    return { ok: false, error: 'Approve the requirement before choosing a Library asset.' }
  }
  if (!libraryAssetId.trim()) return { ok: false, error: 'Choose a Library asset.' }
  return {
    ok: true,
    list: {
      ...list,
      items: list.items.map((entry) => entry.id === itemId
        ? {
            ...entry,
            fulfilledByAssetId: libraryAssetId,
            fulfillmentMethod: method,
            fulfilledByResultId: null,
            fulfillmentHistory: appendFulfillmentLink(entry.fulfillmentHistory, libraryAssetId, method, linkedAt, null),
          }
        : entry),
    },
  }
}

export function markProductionItemsNoLongerRequired(
  list: ProductionList,
  itemIds: string[],
): ProductionList {
  const selected = new Set(itemIds)
  return {
    ...list,
    items: list.items.map((item) => selected.has(item.id)
      ? { ...item, requirementStatus: 'no-longer-required' }
      : item),
  }
}

export function restoreProductionItems(list: ProductionList, itemIds: string[]): ProductionList {
  const selected = new Set(itemIds)
  return {
    ...list,
    items: list.items.map((item) => selected.has(item.id) && item.requirementStatus === 'no-longer-required'
      ? { ...item, requirementStatus: 'needs-review', promptStatus: 'needs-review', approvedAt: null }
      : item),
  }
}

export function addProposedScene(list: ProductionList, name: string): ProductionList {
  const id = makeId('proposed-scene')
  return {
    ...list,
    scenes: [...list.scenes, {
      id,
      sourceKeys: [],
      name: name.trim() || 'Untitled scene',
      manuallyStructured: true,
    }],
  }
}

export function renameProposedScene(
  list: ProductionList,
  sceneId: string,
  name: string,
): ProductionList {
  const next = name.trim() || 'Untitled scene'
  return {
    ...list,
    scenes: list.scenes.map((scene) => scene.id === sceneId
      ? { ...scene, name: next, manuallyStructured: true }
      : scene),
  }
}

export function splitProposedScene(
  list: ProductionList,
  sceneId: string,
  names: string[],
): ProductionList {
  const sceneIndex = list.scenes.findIndex((scene) => scene.id === sceneId)
  const nextNames = names.map((name) => name.trim()).filter(Boolean)
  if (sceneIndex < 0 || nextNames.length < 2) return list

  const replacements = nextNames.map((name) => {
    const id = makeId('proposed-scene')
    return {
      id,
      sourceKeys: list.scenes[sceneIndex].sourceKeys,
      name,
      manuallyStructured: true,
    }
  })
  const scenes = [...list.scenes]
  scenes.splice(sceneIndex, 1, ...replacements)
  const replacementIds = replacements.map((scene) => scene.id)

  return {
    ...list,
    scenes,
    items: list.items.map((item) => {
      if (!item.sceneIds.includes(sceneId)) return item
      return {
        ...item,
        sceneIds: unique(item.sceneIds.flatMap((id) => id === sceneId ? replacementIds : [id])),
        manualFields: unique([...item.manualFields, 'sceneIds']),
      }
    }),
  }
}

export function mergeProposedScenes(
  list: ProductionList,
  sceneIds: string[],
  name: string,
): ProductionList {
  const selected = new Set(sceneIds)
  if (selected.size < 2) return list
  const present = list.scenes.filter((scene) => selected.has(scene.id))
  if (present.length < 2) return list
  const id = makeId('proposed-scene')
  const merged: ProposedScene = {
    id,
    sourceKeys: unique(present.flatMap((scene) => scene.sourceKeys)),
    name: name.trim() || 'Merged scene',
    manuallyStructured: true,
  }
  const firstIndex = list.scenes.findIndex((scene) => selected.has(scene.id))
  const scenes = list.scenes.filter((scene) => !selected.has(scene.id))
  scenes.splice(firstIndex, 0, merged)
  return {
    ...list,
    scenes,
    items: list.items.map((item) => {
      if (!item.sceneIds.some((sceneId) => selected.has(sceneId))) return item
      return {
        ...item,
        sceneIds: unique([...item.sceneIds.filter((sceneId) => !selected.has(sceneId)), id]),
        manualFields: unique([...item.manualFields, 'sceneIds']),
      }
    }),
  }
}

export function addProductionItem(
  list: ProductionList,
  input: {
    name: string
    kind: ProductionItemKind
    provenance: ProductionProvenance
    quantity: number
    sceneIds: string[]
    prompt: string
    identityKey?: string
    variantLabel?: string | null
    backgroundMode?: BackgroundMode | null
  },
): ProductionList {
  const id = makeId('production-item')
  const item = newItem({
    sourceKey: `manual:${id}`,
    sourceFingerprint: `manual:${id}`,
    name: input.name,
    kind: input.kind,
    provenance: input.provenance,
    quantity: input.quantity,
    sceneSourceKeys: [],
    prompt: input.prompt,
    identityKey: input.identityKey,
    variantLabel: input.variantLabel,
    backgroundMode: input.backgroundMode,
  }, unique(input.sceneIds.filter((sceneId) => list.scenes.some((scene) => scene.id === sceneId))))
  item.id = id
  item.manualFields = ['name', 'quantity', 'sceneIds', 'prompt']
  return { ...list, items: [...list.items, item] }
}
