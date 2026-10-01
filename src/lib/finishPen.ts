import { useEditorStore } from '../state/useEditorStore'
import { usePathStore } from '../state/usePathStore'

/** Finish drawing: close the loop if asked, then return to path selection. */
export function finishPen(close = false) {
  const path = usePathStore.getState()
  const active = path.getPath(path.activePathId)
  if (close && (active?.anchors.length ?? 0) > 2) path.setClosed(true)
  useEditorStore.getState().setTool('select')
  useEditorStore.getState().select('camera-path')
}
