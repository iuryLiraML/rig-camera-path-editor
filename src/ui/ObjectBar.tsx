import { useEffect, useRef, useState, type ReactNode } from 'react'
import { remeshSceneObject } from '../lib/meshJobs'
import { objectNeedsRetopo } from '../lib/sceneIO'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore, type ObjectBarPanel } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import {
  CubeIcon,
  DotsIcon,
  ListIcon,
  MagnetIcon,
  MoveIcon,
  SlidersIcon,
} from './icons'
import { DesignInspector } from './RightPanel'
import { TransformPopover } from './TransformPopover'
import { useViewportInsets } from './viewportInsets'

export function ObjectBar() {
  const selection = useEditorStore((s) => s.selection)
  const panel = useEditorStore((s) => s.objectBarPanel)
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const showOutliner = useEditorStore((s) => s.showOutliner)
  const showAddDrawer = useEditorStore((s) => s.showAddDrawer)
  const insets = useViewportInsets()
  const objectId = selection?.startsWith('obj:') ? selection.slice(4) : null
  const object = useSceneStore((s) => (objectId ? s.objects.find((o) => o.id === objectId) : null))

  if (!objectId || !object || showAddDrawer) return null

  const setPanel = (next: ObjectBarPanel) => {
    useEditorStore.getState().setObjectBarPanel(panel === next ? 'none' : next)
  }

  return (
    <div
      className="absolute z-30 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ left: insets.centre, bottom: insets.contentBottom }}
    >
      {panel === 'transform' && <TransformPopover objectId={objectId} />}
      {panel === 'name' && <NamePopover objectId={objectId} />}
      {panel === 'properties' && (
        <div className="panel max-h-[min(70vh,520px)] w-[280px] overflow-y-auto">
          <DesignInspector />
        </div>
      )}
      {panel === 'more' && <MoreMenu objectId={objectId} />}

      <div className="panel flex items-center gap-0.5 px-1.5 py-1">
        <IconBtn title="Shape" active={panel === 'name'} onClick={() => setPanel('name')}>
          <CubeIcon size={14} />
        </IconBtn>
        <IconBtn
          title="Outliner"
          active={showOutliner}
          onClick={() => useEditorStore.getState().toggleOutliner()}
        >
          <ListIcon size={14} />
        </IconBtn>
        <IconBtn title="Properties" active={panel === 'properties'} onClick={() => setPanel('properties')}>
          <SlidersIcon size={14} />
        </IconBtn>
        <IconBtn title="More" active={panel === 'more'} onClick={() => setPanel('more')}>
          <DotsIcon size={14} />
        </IconBtn>
        <span className="mx-1 h-4 w-px bg-line" />
        <IconBtn title="Move (W)" active={panel === 'transform'} onClick={() => setPanel('transform')}>
          <MoveIcon size={14} />
        </IconBtn>
        <IconBtn
          title="Snap to grid"
          active={snapEnabled}
          onClick={() => useEditorStore.getState().toggleSnap()}
        >
          <MagnetIcon size={14} />
        </IconBtn>
      </div>
    </div>
  )
}

function IconBtn({
  title,
  active,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md ${
        active ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function NamePopover({ objectId }: { objectId: string }) {
  const object = useSceneStore((s) => s.objects.find((o) => o.id === objectId))
  const shade = object?.shade ?? 0.7
  if (!object) return null
  return (
    <div className="panel w-64 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-ink">Name</span>
        <button
          type="button"
          onClick={() => useEditorStore.getState().setObjectBarPanel('none')}
          className="text-ink-dim hover:text-ink"
        >
          ×
        </button>
      </div>
      <input
        value={object.name}
        onChange={(e) => useSceneStore.getState().renameObject(objectId, e.target.value)}
        className="mt-2 w-full rounded-md bg-panel-2 px-2 py-1.5 text-[12px] text-ink outline-none"
      />
      <label className="mt-3 block text-[10px] uppercase tracking-wide text-ink-dim">Shade</label>
      <input
        type="range"
        min={0.15}
        max={0.95}
        step={0.01}
        value={shade}
        onChange={(e) => useSceneStore.getState().setObjectShade(objectId, Number(e.target.value))}
        className="mt-1 w-full"
      />
    </div>
  )
}

function MoreMenu({ objectId }: { objectId: string }) {
  const locked = useEditorStore((s) => s.lockedIds.includes(objectId))
  const falKey = useAgentStore((s) => s.falKey)
  const serverFal = useAgentStore((s) => s.serverKeys.fal)
  const canFal = Boolean(falKey.trim()) || serverFal
  const needsRetopo = objectNeedsRetopo(objectId)
  const ref = useRef<HTMLDivElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        useEditorStore.getState().setObjectBarPanel('none')
      }
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  const item = 'w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-2'

  return (
    <div ref={ref} className="panel w-44 p-1">
      <button
        type="button"
        className={item}
        onClick={() => useEditorStore.getState().toggleLock(objectId)}
      >
        {locked ? 'Unlock' : 'Lock'}
      </button>
      <button
        type="button"
        className={item}
        onClick={() => {
          useEditorStore.getState().requestFrame()
          useEditorStore.getState().setObjectBarPanel('none')
        }}
      >
        Front
        <span className="ml-2 text-[10px] text-ink-dim">F</span>
      </button>
      {needsRetopo &&
        (canFal ? (
          <button
            type="button"
            className={item}
            onClick={() => {
              useEditorStore.getState().setObjectBarPanel('none')
              void remeshSceneObject(objectId)
            }}
          >
            Remesh
          </button>
        ) : (
          <button
            type="button"
            className={item}
            onClick={() => {
              useEditorStore.getState().setObjectBarPanel('none')
              useEditorStore.getState().setShowSettings(true)
            }}
          >
            Add Fal key to remesh
          </button>
        ))}
      <button
        type="button"
        className={`w-full rounded-md px-2 py-1.5 text-left text-[11px] ${
          confirmDelete ? 'bg-red-500/15 text-red-400' : 'text-red-400 hover:bg-panel-2'
        }`}
        onClick={() => {
          if (!confirmDelete) {
            setConfirmDelete(true)
            return
          }
          useSceneStore.getState().removeObject(objectId)
          useEditorStore.getState().select(null)
          useEditorStore.getState().setObjectBarPanel('none')
        }}
      >
        {confirmDelete ? 'Delete? Click to confirm' : 'Delete'}
      </button>
    </div>
  )
}
