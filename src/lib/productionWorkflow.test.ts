import { describe, expect, it } from 'vitest'
import {
  addModelResult,
  addProductionItem,
  addProposedScene,
  addReferenceVersion,
  approveReferenceVersion,
  approveProductionItems,
  createProductionList,
  fulfillProductionItem,
  markProductionItemsNoLongerRequired,
  mergeProposedScenes,
  productionGenerationEligibility,
  reconcileProductionList,
  renameProposedScene,
  requestProductionGeneration,
  reviewModelResult,
  splitProposedScene,
  updateProductionItem,
} from './productionWorkflow'

describe('production list', () => {
  it('reconciles script revisions without duplicating identities or deleting approved work', () => {
    const first = reconcileProductionList(createProductionList(), {
      revisionId: 'script-v1',
      scenes: [
        { sourceKey: 'cafe-day', name: 'Cafe — Day' },
        { sourceKey: 'apartment-night', name: 'Apartment — Night' },
      ],
      items: [
        {
          sourceKey: 'character-ana',
          sourceFingerprint: 'ana-v1',
          name: 'Ana',
          kind: 'character',
          provenance: 'explicit',
          quantity: 1,
          sceneSourceKeys: ['cafe-day', 'apartment-night'],
          prompt: 'Ana, late twenties, short dark hair',
        },
        {
          sourceKey: 'prop-chair',
          sourceFingerprint: 'chair-v1',
          name: 'Cafe chair',
          kind: 'prop',
          provenance: 'suggested',
          quantity: 10,
          sceneSourceKeys: ['cafe-day'],
          prompt: 'Simple bentwood cafe chair',
        },
      ],
    })

    const anaId = first.list.items.find((item) => item.sourceKey === 'character-ana')!.id
    const approved = approveProductionItems(first.list, [anaId], 'guidelines-v1', '2026-09-09T12:00:00.000Z')
    const corrected = updateProductionItem(approved, anaId, { name: 'Ana Silva' })
    corrected.items.find((item) => item.id === anaId)!.referenceVersions.push({
      id: 'reference-v1',
      label: 'Approved front view',
      uri: 'library://reference-v1',
      role: 'primary',
      status: 'approved',
      createdAt: '2026-09-09T12:05:00.000Z',
      approvedAt: '2026-09-09T12:06:00.000Z',
      prompt: 'Ana, late twenties, short dark hair',
      guidelineVersionId: 'guidelines-v1',
      guidelineException: '',
    })
    corrected.items.find((item) => item.id === anaId)!.activeReferenceVersionIds = ['reference-v1']
    corrected.items.find((item) => item.id === anaId)!.modelResults.push({
      id: 'result-v1',
      libraryAssetId: 'asset-ana',
      status: 'approved',
      createdAt: '2026-09-09T12:10:00.000Z',
      reviewedAt: '2026-09-09T12:11:00.000Z',
      prompt: 'Ana, late twenties, short dark hair',
      guidelineVersionId: 'guidelines-v1',
      guidelineException: '',
      referenceVersionIds: ['reference-v1'],
    })
    corrected.items.find((item) => item.id === anaId)!.fulfilledByAssetId = 'asset-ana'

    const second = reconcileProductionList(corrected, {
      revisionId: 'script-v2',
      scenes: [{ sourceKey: 'cafe-day', name: 'Cafe — Day' }],
      items: [
        {
          sourceKey: 'prop-chair',
          sourceFingerprint: 'chair-v1',
          name: 'Cafe chair',
          kind: 'prop',
          provenance: 'suggested',
          quantity: 10,
          sceneSourceKeys: ['cafe-day'],
          prompt: 'Simple bentwood cafe chair',
        },
      ],
    })

    const ana = second.list.items.find((item) => item.id === anaId)!
    expect(ana.name).toBe('Ana Silva')
    expect(ana.requirementStatus).toBe('no-longer-required')
    expect(ana.referenceVersions).toHaveLength(1)
    expect(ana.modelResults).toHaveLength(1)
    expect(ana.fulfilledByAssetId).toBe('asset-ana')
    expect(second.diff.removedItemIds).toEqual([anaId])
    expect(second.list.items.filter((item) => item.sourceKey === 'character-ana')).toHaveLength(1)
    expect(second.list.items.find((item) => item.sourceKey === 'prop-chair')!.requirementStatus).toBe('needs-review')
  })

  it('reopens only changed requirements for review after a script revision', () => {
    const initial = reconcileProductionList(createProductionList(), {
      revisionId: 'script-v1',
      scenes: [{ sourceKey: 'studio', name: 'Studio' }],
      items: [
        {
          sourceKey: 'hero', sourceFingerprint: 'hero-v1', name: 'Hero', kind: 'character',
          provenance: 'explicit', quantity: 1, sceneSourceKeys: ['studio'], prompt: 'Hero in a dark coat',
        },
        {
          sourceKey: 'desk', sourceFingerprint: 'desk-v1', name: 'Desk', kind: 'prop',
          provenance: 'explicit', quantity: 1, sceneSourceKeys: ['studio'], prompt: 'Wooden desk',
        },
      ],
    }).list
    const approved = approveProductionItems(initial, initial.items.map((item) => item.id), 'guidelines-v1')
    const revised = reconcileProductionList(approved, {
      revisionId: 'script-v2',
      scenes: [{ sourceKey: 'studio', name: 'Studio' }],
      items: [
        {
          sourceKey: 'hero', sourceFingerprint: 'hero-v2', name: 'Hero', kind: 'character',
          provenance: 'explicit', quantity: 1, sceneSourceKeys: ['studio'], prompt: 'Hero in a pale coat',
        },
        {
          sourceKey: 'desk', sourceFingerprint: 'desk-v1', name: 'Desk', kind: 'prop',
          provenance: 'explicit', quantity: 1, sceneSourceKeys: ['studio'], prompt: 'Wooden desk',
        },
      ],
    })

    const hero = revised.list.items.find((item) => item.sourceKey === 'hero')!
    const desk = revised.list.items.find((item) => item.sourceKey === 'desk')!
    expect(revised.diff.changedItemIds).toEqual([hero.id])
    expect(hero.requirementStatus).toBe('needs-review')
    expect(hero.promptStatus).toBe('needs-review')
    expect(desk.requirementStatus).toBe('approved')
    expect(desk.promptStatus).toBe('approved')
  })

  it('gates reference and 3D review while approved items advance independently', () => {
    const proposed = reconcileProductionList(createProductionList(), {
      revisionId: 'script-v1',
      scenes: [{ sourceKey: 'studio', name: 'Studio' }],
      items: [
        {
          sourceKey: 'hero', sourceFingerprint: 'hero-v1', name: 'Hero', kind: 'character',
          provenance: 'explicit', quantity: 1, sceneSourceKeys: ['studio'], prompt: 'Hero reference',
        },
        {
          sourceKey: 'desk', sourceFingerprint: 'desk-v1', name: 'Desk', kind: 'prop',
          provenance: 'explicit', quantity: 1, sceneSourceKeys: ['studio'], prompt: 'Studio desk',
        },
      ],
    }).list
    const [hero, desk] = proposed.items

    expect(addReferenceVersion(proposed, hero.id, {
      label: 'Front view', uri: 'library://hero-front',
    }, '2026-09-09T13:00:00.000Z')).toEqual({
      ok: false,
      error: 'Approve the requirement and prompt before adding references.',
    })

    const requirementsApproved = approveProductionItems(
      proposed,
      [hero.id],
      'guidelines-v2',
      '2026-09-09T13:01:00.000Z',
    )
    expect(requirementsApproved.items.find((item) => item.id === desk.id)!.requirementStatus).toBe('needs-review')

    const referenceAdded = addReferenceVersion(requirementsApproved, hero.id, {
      label: 'Front view', uri: 'library://hero-front',
    }, '2026-09-09T13:02:00.000Z')
    expect(referenceAdded.ok).toBe(true)
    if (!referenceAdded.ok) return
    const storedReference = referenceAdded.list.items.find((item) => item.id === hero.id)!.referenceVersions[0]
    expect(storedReference).toMatchObject({
      role: 'primary',
      prompt: 'Hero reference',
      guidelineVersionId: 'guidelines-v2',
    })
    const referenceId = storedReference.id
    const referenceApproved = approveReferenceVersion(
      referenceAdded.list,
      hero.id,
      referenceId,
      '2026-09-09T13:03:00.000Z',
    )

    expect(addModelResult(referenceAdded.list, hero.id, 'asset-hero', '2026-09-09T13:04:00.000Z')).toEqual({
      ok: false,
      error: 'Approve a reference before adding a 3D result.',
    })
    const variantAdded = addReferenceVersion(referenceApproved, hero.id, {
      label: 'Evening wardrobe', uri: 'library://hero-evening', role: 'variant',
    }, '2026-09-09T13:03:30.000Z')
    expect(variantAdded.ok).toBe(true)
    if (!variantAdded.ok) return
    const variantId = variantAdded.list.items.find((item) => item.id === hero.id)!.referenceVersions[1].id
    const referencesApproved = approveReferenceVersion(variantAdded.list, hero.id, variantId)
    const resultAdded = addModelResult(referencesApproved, hero.id, 'asset-hero', '2026-09-09T13:04:00.000Z')
    expect(resultAdded.ok).toBe(true)
    if (!resultAdded.ok) return
    const resultId = resultAdded.list.items.find((item) => item.id === hero.id)!.modelResults[0].id
    const resultApproved = reviewModelResult(
      resultAdded.list,
      hero.id,
      resultId,
      'approved',
      '2026-09-09T13:05:00.000Z',
    )
    const fulfilled = resultApproved.items.find((item) => item.id === hero.id)!
    expect(fulfilled.modelResults[0].status).toBe('approved')
    expect(fulfilled.modelResults[0]).toMatchObject({
      prompt: 'Hero reference',
      guidelineVersionId: 'guidelines-v2',
      referenceVersionIds: [referenceId, variantId],
    })
    expect(fulfilled.fulfilledByAssetId).toBe('asset-hero')
    expect(fulfilled.fulfillmentMethod).toBe('generated')
    expect(fulfilled.fulfillmentHistory).toEqual([{
      libraryAssetId: 'asset-hero',
      method: 'generated',
      linkedAt: '2026-09-09T13:05:00.000Z',
      modelResultId: resultId,
    }])

    const confirmedExisting = fulfillProductionItem(resultApproved, hero.id, 'asset-hero', 'existing')
    expect(confirmedExisting.ok).toBe(true)
    if (!confirmedExisting.ok) return
    const rejectedOldAttempt = reviewModelResult(confirmedExisting.list, hero.id, resultId, 'rejected')
    expect(rejectedOldAttempt.items.find((item) => item.id === hero.id)).toMatchObject({
      fulfilledByAssetId: 'asset-hero',
      fulfillmentMethod: 'existing',
      fulfilledByResultId: null,
    })
    const retryRequested = requestProductionGeneration(
      rejectedOldAttempt,
      hero.id,
      'model',
      { retryOfResultId: resultId, createdAt: '2026-09-09T13:06:00.000Z' },
    )
    expect(retryRequested.ok).toBe(true)
    if (!retryRequested.ok) return
    expect(retryRequested.list.items.find((item) => item.id === hero.id)!.generationRequests[0]).toMatchObject({
      stage: 'model',
      retryOfResultId: resultId,
    })

    const staleResult = updateProductionItem(resultAdded.list, hero.id, { prompt: 'Hero reference, pale coat' })
    const staleApproval = reviewModelResult(staleResult, hero.id, resultId, 'approved')
    expect(staleApproval.items.find((item) => item.id === hero.id)).toMatchObject({
      fulfilledByAssetId: null,
      modelResults: [{ id: resultId, status: 'needs-review' }],
    })
    const staleReapproved = approveProductionItems(staleResult, [hero.id], 'guidelines-v2')
    const staleAfterReapproval = reviewModelResult(staleReapproved, hero.id, resultId, 'approved')
    expect(staleAfterReapproval.items.find((item) => item.id === hero.id)).toMatchObject({
      fulfilledByAssetId: null,
      modelResults: [{ id: resultId, status: 'needs-review' }],
    })
    const exceptionChanged = updateProductionItem(resultAdded.list, hero.id, { guidelineException: 'Use a pale coat.' })
    const exceptionReapproved = approveProductionItems(exceptionChanged, [hero.id], 'guidelines-v2')
    const staleExceptionApproval = reviewModelResult(exceptionReapproved, hero.id, resultId, 'approved')
    expect(staleExceptionApproval.items.find((item) => item.id === hero.id)).toMatchObject({
      fulfilledByAssetId: null,
      modelResults: [{ id: resultId, status: 'needs-review' }],
    })

    const changedPrompt = updateProductionItem(referencesApproved, hero.id, { prompt: 'Hero reference, pale coat' })
    expect(addModelResult(changedPrompt, hero.id, 'asset-hero-v2')).toEqual({
      ok: false,
      error: 'Approve the current requirement and prompt before adding a 3D result.',
    })
  })

  it('fulfills an approved requirement from the Library without requiring references', () => {
    const list = reconcileProductionList(createProductionList(), {
      revisionId: 'manual-v1',
      scenes: [],
      items: [{
        sourceKey: 'chair', sourceFingerprint: 'chair-v1', name: 'Chair', kind: 'prop',
        provenance: 'explicit', quantity: 10, sceneSourceKeys: [], prompt: 'Chair',
      }],
    }).list
    const itemId = list.items[0].id
    const approved = approveProductionItems(list, [itemId], 'guidelines-v1')
    const fulfilled = fulfillProductionItem(approved, itemId, 'asset-chair', 'existing', '2026-09-09T13:10:00.000Z')

    expect(fulfilled.ok).toBe(true)
    if (!fulfilled.ok) return
    expect(fulfilled.list.items[0].fulfilledByAssetId).toBe('asset-chair')
    expect(fulfilled.list.items[0].fulfillmentMethod).toBe('existing')
    expect(fulfilled.list.items[0].referenceVersions).toEqual([])
    const replaced = fulfillProductionItem(
      fulfilled.list,
      itemId,
      'asset-chair-v2',
      'imported',
      '2026-09-09T13:11:00.000Z',
    )
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) return
    expect(replaced.list.items[0].fulfillmentHistory).toEqual([
      { libraryAssetId: 'asset-chair', method: 'existing', linkedAt: '2026-09-09T13:10:00.000Z', modelResultId: null },
      { libraryAssetId: 'asset-chair-v2', method: 'imported', linkedAt: '2026-09-09T13:11:00.000Z', modelResultId: null },
    ])
  })

  it('shares an approved primary reference across character variants and records generation intents', () => {
    const proposed = reconcileProductionList(createProductionList(), {
      revisionId: 'script-v1',
      scenes: [],
      items: [
        {
          sourceKey: 'ana-base', sourceFingerprint: 'ana-base-v1', name: 'Ana', kind: 'character',
          provenance: 'explicit', quantity: 1, sceneSourceKeys: [], prompt: 'Ana base', identityKey: 'ana',
        },
        {
          sourceKey: 'ana-evening', sourceFingerprint: 'ana-evening-v1', name: 'Ana — Evening', kind: 'character',
          provenance: 'explicit', quantity: 1, sceneSourceKeys: [], prompt: 'Ana evening wardrobe',
          identityKey: 'ana', variantLabel: 'Evening wardrobe',
        },
      ],
    }).list
    const approved = approveProductionItems(proposed, proposed.items.map((item) => item.id), 'guidelines-v1')
    const [base, variant] = approved.items
    const referenceAdded = addReferenceVersion(approved, base.id, {
      label: 'Ana identity', uri: 'library://ana-primary', role: 'primary',
    })
    expect(referenceAdded.ok).toBe(true)
    if (!referenceAdded.ok) return
    const referenceId = referenceAdded.list.items[0].referenceVersions[0].id
    const referenceApproved = approveReferenceVersion(referenceAdded.list, base.id, referenceId)

    expect(productionGenerationEligibility(referenceApproved, referenceApproved.items[1]).model).toBe(true)
    const request = requestProductionGeneration(
      referenceApproved,
      variant.id,
      'model',
      { createdAt: '2026-09-09T14:00:00.000Z' },
    )
    expect(request.ok).toBe(true)
    if (!request.ok) return
    expect(request.list.items[1].generationRequests[0]).toMatchObject({
      stage: 'model',
      prompt: 'Ana evening wardrobe',
      guidelineVersionId: 'guidelines-v1',
      referenceVersionIds: [referenceId],
      retryOfResultId: null,
    })

    const replacementAdded = addReferenceVersion(referenceApproved, variant.id, {
      label: 'Ana identity v2', uri: 'library://ana-primary-v2', role: 'primary',
    })
    expect(replacementAdded.ok).toBe(true)
    if (!replacementAdded.ok) return
    const replacementId = replacementAdded.list.items[1].referenceVersions[0].id
    const replacementApproved = approveReferenceVersion(replacementAdded.list, variant.id, replacementId)
    expect(replacementApproved.items[0].activeReferenceVersionIds).toEqual([])
    expect(replacementApproved.items[1].activeReferenceVersionIds).toEqual([replacementId])
    const baseResult = addModelResult(replacementApproved, base.id, 'asset-ana-v2')
    expect(baseResult.ok).toBe(true)
    if (!baseResult.ok) return
    expect(baseResult.list.items[0].modelResults[0].referenceVersionIds).toEqual([replacementId])
  })

  it('edits scene structure and retires requirements without deleting their assets', () => {
    const withCafe = addProposedScene(createProductionList(), 'Cafe')
    const cafeId = withCafe.scenes[0].id
    const withStreet = addProposedScene(withCafe, 'Street')
    const streetId = withStreet.scenes[1].id
    const named = renameProposedScene(withStreet, streetId, 'Street — Night')
    const withChair = addProductionItem(named, {
      name: 'Chair', kind: 'prop', provenance: 'explicit', quantity: 4,
      sceneIds: [cafeId, streetId], prompt: 'Bentwood chair',
    })
    withChair.items[0].fulfilledByAssetId = 'asset-chair'
    withChair.items[0].fulfillmentMethod = 'existing'

    const merged = mergeProposedScenes(withChair, [cafeId, streetId], 'Exterior cafe')
    expect(merged.scenes.map((scene) => scene.name)).toEqual(['Exterior cafe'])
    expect(merged.items[0].sceneIds).toEqual([merged.scenes[0].id])

    const split = splitProposedScene(merged, merged.scenes[0].id, ['Exterior', 'Interior'])
    expect(split.scenes.map((scene) => scene.name)).toEqual(['Exterior', 'Interior'])
    expect(split.items[0].sceneIds).toEqual(split.scenes.map((scene) => scene.id))

    const retired = markProductionItemsNoLongerRequired(split, [split.items[0].id])
    expect(retired.items[0]).toMatchObject({
      requirementStatus: 'no-longer-required',
      fulfilledByAssetId: 'asset-chair',
      fulfillmentMethod: 'existing',
    })
  })

  it('preserves merged proposed scenes and their assignments during reanalysis', () => {
    const proposal = {
      revisionId: 'script-v1',
      scenes: [
        { sourceKey: 'scene-1', name: 'Hall' },
        { sourceKey: 'scene-2', name: 'Kitchen' },
      ],
      items: [{
        sourceKey: 'hero', sourceFingerprint: 'hero-v1', name: 'Hero', kind: 'character' as const,
        provenance: 'explicit' as const, quantity: 1, sceneSourceKeys: ['scene-1', 'scene-2'], prompt: 'Hero',
      }],
    }
    const initial = reconcileProductionList(createProductionList(), proposal).list
    const merged = mergeProposedScenes(initial, initial.scenes.map((scene) => scene.id), 'Apartment')
    const revised = reconcileProductionList(merged, { ...proposal, revisionId: 'script-v2' }).list

    expect(revised.scenes).toHaveLength(1)
    expect(revised.scenes[0]).toMatchObject({
      name: 'Apartment',
      sourceKeys: ['scene-1', 'scene-2'],
      manuallyStructured: true,
    })
    expect(revised.items[0].sceneIds).toEqual([revised.scenes[0].id])
  })
})
