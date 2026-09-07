import { useEditorStore, type SelectableId, type SelectionMemberId } from './useEditorStore'

export type PointerPickAction = 'toggle' | 'replace' | 'keep-group'

/** Pointer-down selection for objects: Shift toggles; a grouped member stays until a click without drag. */
export function pointerPickMember(
  id: SelectionMemberId,
  opts: { additive: boolean },
): PointerPickAction {
  const editor = useEditorStore.getState()
  if (opts.additive) {
    const selected = editor.selectionIds.includes(id)
    editor.selectMany(
      selected ? editor.selectionIds.filter((item) => item !== id) : [...editor.selectionIds, id],
    )
    return 'toggle'
  }
  if (editor.selectionIds.includes(id) && editor.selectionIds.length > 1) {
    return 'keep-group'
  }
  if (id.startsWith('obj:')) {
    editor.select(id as SelectableId)
  }
  return 'replace'
}

export function collapsePointerPick(id: SelectionMemberId) {
  if (id.startsWith('obj:')) {
    useEditorStore.getState().select(id as SelectableId)
  }
}
