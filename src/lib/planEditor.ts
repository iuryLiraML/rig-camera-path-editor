/**
 * The floor-plan editor's session state: which Library plan is open and its
 * live model. The graph is the asset (ADR 0003), so saving writes the walls
 * and openings back onto the Library record — there is no second copy.
 *
 * Navigation mirrors the other workspaces: leaving the editor flushes the
 * project first, and the open plan's identity lives in the URL so a refresh
 * reopens the same plan rather than an empty one.
 */
import { create } from 'zustand'
import { createPlan, planFromJSON, planToJSON, type PlanState } from './floorPlanModel'
import { createPlanAsset, renamePlanAsset, resolveLibraryAsset, savePlanAsset } from './library'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'

interface PlanEditorState {
  /** The live plan being edited. */
  plan: PlanState
  /** The Library asset id this plan is saved under, or null before the first save. */
  assetId: string | null
  /** The active tool. */
  tool: 'select' | 'wall' | 'room' | 'door' | 'window'
  /** The current selection: a wall, an opening, or a shared corner. */
  sel: { kind: 'wall' | 'opening'; id: string } | { kind: 'vertex'; key: string } | null
  /** Bumped by the Fit action so the 3D preview reframes on demand (FR-025). */
  fitNonce: number
  /** Last published model version; cursor movement never invalidates the solid. */
  revision: number
  note: string
  /** Notify both views after an in-place model action. */
  publish: () => void
  setPlan: (plan: PlanState) => void
  setTool: (tool: PlanEditorState['tool']) => void
  setSel: (sel: PlanEditorState['sel']) => void
  requestFit: () => void
}

export const usePlanEditorStore = create<PlanEditorState>((set) => ({
  plan: createPlan(),
  assetId: null,
  tool: 'room',
  sel: null,
  fitNonce: 0,
  revision: 0,
  note: 'Empty plan.',
  publish: () => set((s) => ({
    note: s.plan.note,
    ...(s.revision !== s.plan.version ? { plan: { ...s.plan }, revision: s.plan.version } : {}),
  })),
  setPlan: (plan) => set({ plan, revision: plan.version, note: plan.note }),
  setTool: (tool) => set((s) => {
    s.plan.note = tool === 'select' ? 'Select a wall, corner or opening to edit.'
      : tool === 'room' ? 'Drag to draw a rectangular room.'
      : tool === 'wall' ? 'Click to chain walls. Escape finishes the chain.'
      : 'Hover a wall to preview the opening, then click to place.'
    return { tool, note: s.plan.note, sel: tool === 'select' ? s.sel : null,
      plan: s.plan.chain && tool !== 'wall' ? { ...s.plan, chain: null } : s.plan }
  }),
  setSel: (sel) => set({ sel }),
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
}))

/**
 * Open the floor-plan editor on a Library plan, creating the asset when id is
 * null. The project is flushed first, as leaving any editor is.
 */
export async function goPlan(planId: string | null, signal?: AbortSignal): Promise<boolean> {
  const { leaveEditorTo } = await import('./projects')
  // Reuse the save-flush path; the view it would set is overridden below.
  const flushed = await leaveEditorTo('library', signal)
  if (flushed === false) return false
  if (signal?.aborted) return false

  let id = planId
  if (!id) {
    const { useLibraryStore } = await import('./library')
    const viewing = useLibraryStore.getState().filters.collectionId
    id = await createPlanAsset(viewing === 'all' || viewing === 'unfiled' ? null : viewing)
  }
  const asset = await resolveLibraryAsset(id)
  if (signal?.aborted) return false
  if (!asset || asset.kind !== 'plan') {
    useSceneStore.getState().showNotice('That plan could not be found')
    const { goLibrary } = await import('./projects')
    await goLibrary(signal)
    return false
  }
  const editor = usePlanEditorStore.getState()
  const plan = asset.plan ? planFromJSON(asset.plan) : createPlan()
  plan.note = plan.walls.length ? 'Select a wall or corner to edit the room.' : 'Draw a room or start a wall.'
  editor.setPlan(plan)
  usePlanEditorStore.setState({ assetId: id, tool: 'select', sel: null })
  const ed = useEditorStore.getState()
  ed.setPlanId(id)
  ed.setAppView('plan')
  return true
}

/** Save the live plan back onto its Library asset. */
export async function saveActivePlan(): Promise<void> {
  const { assetId, plan } = usePlanEditorStore.getState()
  if (!assetId) return
  const json = planToJSON(plan)
  await savePlanAsset(assetId, { walls: json.walls, openings: json.openings })
}

/** Rename the open plan from the title chip. */
export async function renameActivePlan(name: string): Promise<void> {
  const { assetId } = usePlanEditorStore.getState()
  if (!assetId) return
  await renamePlanAsset(assetId, name)
}

/** Leave the editor, saving first, back to the Library shelf. */
export async function leavePlan(signal?: AbortSignal): Promise<boolean> {
  await saveActivePlan()
  const { goLibrary } = await import('./projects')
  return goLibrary(signal)
}
