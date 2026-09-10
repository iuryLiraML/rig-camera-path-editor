// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectWorkflow } from '../lib/projectWorkflow'
import { addModelResult, createProductionList, reconcileProductionList } from '../lib/productionWorkflow'
import { useLibraryStore } from '../lib/library'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { ProductionListDialog } from './ProductionListDialog'

describe('ProductionListDialog', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:asset-preview') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const workflow = createProjectWorkflow('Film')
    workflow.production = reconcileProductionList(createProductionList(), {
      revisionId: 'script-v1',
      scenes: [{ sourceKey: 'cafe', name: 'Cafe' }],
      items: [
        {
          sourceKey: 'ana', sourceFingerprint: 'ana-v1', name: 'Ana', kind: 'character',
          provenance: 'explicit', quantity: 1, sceneSourceKeys: ['cafe'], prompt: 'Ana',
        },
        {
          sourceKey: 'chair', sourceFingerprint: 'chair-v1', name: 'Cafe chair', kind: 'prop',
          provenance: 'suggested', quantity: 10, sceneSourceKeys: ['cafe'], prompt: 'Bentwood chair',
        },
      ],
    }).list
    useProjectStore.setState({
      projectId: 'project-1',
      name: 'Film',
      workflow,
      guidelines: 'Monochrome production design',
      scenes: [{ id: workflow.production.scenes[0].id, name: 'Cafe' }],
    })
    useLibraryStore.setState({ assets: [], selectedId: null })
    useEditorStore.setState({ showProduction: true } as never)
  })

  afterEach(() => cleanup())

  it('approves only selected requirements and keeps pending suggestions independent', () => {
    const { getByRole, getByText } = render(<ProductionListDialog />)

    expect(getByText('Production list')).toBeTruthy()
    expect(getByText('Ana')).toBeTruthy()
    expect(getByText('Suggested')).toBeTruthy()

    fireEvent.click(getByRole('checkbox', { name: 'Select Ana' }))
    fireEvent.click(getByRole('button', { name: 'Approve selected' }))

    const items = useProjectStore.getState().workflow.production.items
    expect(items.find((item) => item.name === 'Ana')!.requirementStatus).toBe('approved')
    expect(items.find((item) => item.name === 'Cafe chair')!.requirementStatus).toBe('needs-review')
  })

  it('adds a manual requirement and fulfills it with a confirmed Library asset', () => {
    useLibraryStore.setState({
      assets: [{
        id: 'asset-table', name: 'Wood table', kind: 'model', format: 'glb', bufferKey: 'buffer-table',
        source: 'import', createdAt: 1, ownerId: 'local', collectionId: null, tags: [],
      }],
    })
    const { getByRole, getByLabelText, getByText } = render(<ProductionListDialog />)

    fireEvent.click(getByRole('button', { name: 'Add requirement' }))
    fireEvent.change(getByLabelText('Requirement name'), { target: { value: 'Dining table' } })
    fireEvent.change(getByLabelText('Requirement prompt'), { target: { value: 'Solid wood dining table' } })
    fireEvent.click(getByRole('button', { name: 'Save requirement' }))
    fireEvent.click(getByText('Dining table'))
    fireEvent.click(getByRole('button', { name: 'Approve requirement and prompt' }))
    fireEvent.click(getByRole('button', { name: '3 3D review' }))
    fireEvent.change(getByLabelText('Library asset'), { target: { value: 'asset-table' } })
    fireEvent.click(getByRole('button', { name: 'Use Library asset' }))

    const item = useProjectStore.getState().workflow.production.items.find((entry) => entry.name === 'Dining table')!
    expect(item).toMatchObject({
      requirementStatus: 'approved',
      fulfilledByAssetId: 'asset-table',
      fulfillmentMethod: 'existing',
    })
  })

  it('keeps reference and generated 3D approval as separate review stages', async () => {
    useLibraryStore.setState({
      assets: [{
        id: 'asset-ana', name: 'Ana generated model', kind: 'model', format: 'glb', bufferKey: 'buffer-ana',
        source: 'import', createdAt: 1, ownerId: 'local', collectionId: null, tags: [],
        thumbnail: new Blob(['preview'], { type: 'image/png' }),
      }],
    })
    const { getByRole, getByLabelText, getByText, findByRole } = render(<ProductionListDialog />)

    fireEvent.click(getByText('Ana'))
    fireEvent.click(getByRole('button', { name: 'Approve requirement and prompt' }))
    fireEvent.click(getByRole('button', { name: '2 References' }))
    fireEvent.click(getByRole('button', { name: 'Generate references' }))
    expect(getByRole('group', { name: 'Confirm generation' })).toBeTruthy()
    fireEvent.click(getByRole('button', { name: 'Cancel' }))
    fireEvent.change(getByLabelText('Reference name'), { target: { value: 'Ana master reference' } })
    fireEvent.change(getByLabelText('Reference location'), { target: { value: 'library://ana-reference' } })
    fireEvent.click(getByRole('button', { name: 'Add reference version' }))
    fireEvent.click(getByRole('button', { name: 'Approve' }))
    fireEvent.click(getByRole('button', { name: '3 3D review' }))
    fireEvent.click(getByRole('button', { name: 'Generate 3D assets' }))
    fireEvent.click(getByRole('button', { name: '3 3D review' }))
    fireEvent.change(getByLabelText('Library asset'), { target: { value: 'asset-ana' } })
    expect(await findByRole('img', { name: 'Ana generated model preview' })).toBeTruthy()
    act(() => {
      const current = useProjectStore.getState().workflow.production
      const result = addModelResult(current, current.items[0].id, 'asset-ana')
      if (result.ok) useProjectStore.getState().setProduction(result.list)
    })
    fireEvent.click(getByRole('button', { name: 'Approve' }))

    const ana = useProjectStore.getState().workflow.production.items.find((item) => item.name === 'Ana')!
    expect(ana.referenceVersions[0].status).toBe('approved')
    expect(ana.modelResults[0].status).toBe('approved')
    expect(ana.generationRequests).toEqual([])
    expect(ana).toMatchObject({ fulfilledByAssetId: 'asset-ana', fulfillmentMethod: 'generated' })
  })

  it('marks a requirement no longer required and keeps it available in history', () => {
    const { getByRole, getByText, queryByText } = render(<ProductionListDialog />)

    fireEvent.click(getByText('Cafe chair'))
    fireEvent.click(getByRole('button', { name: 'Mark no longer required' }))
    expect(queryByText('Cafe chair')).toBeNull()

    fireEvent.click(getByRole('button', { name: 'No longer required' }))
    expect(getByText('Cafe chair')).toBeTruthy()
    expect(useProjectStore.getState().workflow.production.items).toHaveLength(2)
  })
})
