// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { createPlan, planActions, type PlanState } from '../lib/floorPlanModel'
import { usePlanEditorStore } from '../lib/planEditor'
import { PlanEditorWorkspace } from './PlanEditorWorkspace'
import type { LibraryAsset } from '../lib/library'

vi.mock('./PlanPreview3D', () => ({ PlanPreview3D: ({ plan }: { plan: PlanState }) => <output data-testid="preview">{plan.walls[0]?.height}</output> }))
vi.mock('../lib/library', () => ({ useLibraryStore: (fn: (state: { assets: LibraryAsset[] }) => unknown) => fn({ assets: [] }) }))
let root: ReturnType<typeof createRoot>
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })
it('publishes inspector changes to the sibling 3D preview immediately', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, { get: () => () => {} }) as ReturnType<HTMLCanvasElement['getContext']>)
  const plan = createPlan()
  planActions.stampRectangle(plan, { x: 0, y: 0 }, { x: 4, y: 4 })
  usePlanEditorStore.setState({ plan, sel: null })
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<PlanEditorWorkspace />))
  const input = host.querySelector('input[type="number"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '3')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
  expect(plan.walls[0]!.height).toBe(3)
  expect(host.querySelector('output')!.textContent).toBe('3')
})
