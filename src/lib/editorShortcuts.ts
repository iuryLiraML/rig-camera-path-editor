import { useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { useEditorStore } from '../state/useEditorStore'
import { usePathStore } from '../state/usePathStore'
import { useSceneStore } from '../state/useSceneStore'
import { isObjectKeyFocus } from './keyAtPlayhead'
import { deleteKeyframeAtPlayhead, deleteSelectedTimelineKey } from './timelineKey'

export function isTextEditing(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLElement && el.isContentEditable) return true
  if (el instanceof HTMLInputElement) {
    return el.type !== 'number' && el.type !== 'range'
  }
  return false
}

export function isKeyableField(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  return el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'range')
}

/** Shortcuts the global handler may take while a number/range field is focused. */
export function isKeyableShortcut(key: string): boolean {
  return key === 'i' || key === 'I' || key === 'Delete' || key === 'Escape'
}

/**
 * Delete / Backspace: timeline key, then playhead key on a focused property,
 * then the selected object / camera / path anchors.
 *
 * Number fields keep Backspace (and Delete when there is no key to remove) so
 * typing a value is not also a destructive scene action.
 */
export function applyDeleteShortcut(
  key: string,
  options?: { keyableField?: boolean },
): boolean {
  if (key !== 'Delete' && key !== 'Backspace') return false
  const keyableField = options?.keyableField ?? isKeyableField()
  if (key === 'Backspace' && keyableField) return false

  // Transform channel focus: unkey the playhead first. I selects the new key,
  // and removing that id alone would leave a legacy pose driving the channel.
  if (isObjectKeyFocus(useEditorStore.getState().keyableFocus)) {
    if (deleteKeyframeAtPlayhead()) return true
  }

  if (deleteSelectedTimelineKey()) return true
  if (deleteKeyframeAtPlayhead()) return true
  if (keyableField) return false

  const editor = useEditorStore.getState()
  const path = usePathStore.getState()

  if (path.selectedAnchorIds.length > 0) {
    path.removeAnchors(path.selectedAnchorIds)
    return true
  }

  if (editor.selection === 'cinema-camera' && !editor.playMode) {
    const cameras = useCameraOptionsStore.getState()
    if (cameras.options.length > 1) {
      cameras.removeOption(cameras.activeOptionId)
      useSceneStore.getState().showNotice('Camera deleted')
    } else {
      useSceneStore.getState().showNotice('The last camera cannot be deleted')
    }
    return true
  }

  if (editor.selection?.startsWith('obj:') && !editor.playMode) {
    useSceneStore.getState().removeObject(editor.selection.slice(4))
    editor.select(null)
    editor.setObjectBarPanel('none')
    return true
  }

  return false
}
