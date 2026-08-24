import { useEditorStore } from '../../state/useEditorStore'
import { TIMELINE_HEIGHT_MAX, TIMELINE_MIN } from '../viewportInsets'
import { clamp } from './timelineShared'

/** AE-style divider: drag the top edge; up grows the dock. */
export function DockResizeHandle() {
  return (
    <button
      type="button"
      aria-label="Resize timeline"
      data-timeline-resize
      title="Drag to resize the timeline"
      className="absolute inset-x-0 -top-px z-30 h-2 cursor-ns-resize"
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const startY = e.clientY
        const startH = useEditorStore.getState().timelineHeight
        const move = (ev: PointerEvent) => {
          useEditorStore
            .getState()
            .setTimelineHeight(clamp(startH + (startY - ev.clientY), TIMELINE_MIN, TIMELINE_HEIGHT_MAX))
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}
