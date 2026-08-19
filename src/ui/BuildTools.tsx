import { useEditorStore } from '../state/useEditorStore'
import { PlusIcon } from './icons'
import { GUTTER, useViewportInsets } from './viewportInsets'

export function BuildTools() {
  const showAddDrawer = useEditorStore((s) => s.showAddDrawer)
  const insets = useViewportInsets()
  if (showAddDrawer) return null

  return (
    <div
      className="panel absolute z-30 flex items-center gap-0.5 px-1 py-1"
      style={{ left: insets.left, bottom: insets.bottom + GUTTER }}
    >
      <button
        type="button"
        title="Add an object"
        onClick={() => useEditorStore.getState().toggleAddDrawer()}
        className={`flex h-8 w-8 items-center justify-center rounded-md ${
          showAddDrawer ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
        }`}
      >
        <PlusIcon size={15} />
      </button>
    </div>
  )
}
