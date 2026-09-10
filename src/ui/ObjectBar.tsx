import { useEffect, useRef, useState, type ReactNode } from 'react'
import { remeshSceneObject } from '../lib/meshJobs'
import {
  formatTriangleCount,
  isRemeshPlaceholder,
  keepHighMesh,
  objectNeedsRetopo,
} from '../lib/sceneIO'
import { hasMeshGeometry, type AssetDisplayMode } from '../lib/assetDisplay'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore, type ObjectBarPanel } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import {
  DotsIcon,
  ListIcon,
  MagnetIcon,
  MoveIcon,
} from './icons'
import { useViewportInsets } from './viewportInsets'

export function ObjectBar() {
  const selection = useEditorStore((s) => s.selection)
  const panel = useEditorStore((s) => s.objectBarPanel)
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const showOutliner = useEditorStore((s) => s.showOutliner)
  const tool = useEditorStore((s) => s.tool)
  const gizmoMode = useEditorStore((s) => s.gizmoMode)
  const insets = useViewportInsets()
  const objectId = selection?.startsWith('obj:') ? selection.slice(4) : null
  const object = useSceneStore((s) => (objectId ? s.objects.find((o) => o.id === objectId) : null))
  const envSelected = selection === 'env'

  if (!envSelected && (!objectId || !object)) return null

  const setPanel = (next: ObjectBarPanel) => {
    useEditorStore.getState().setObjectBarPanel(panel === next ? 'none' : next)
  }

  return (
    <div
      className="absolute z-30 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ left: insets.centre, bottom: insets.contentBottom }}
    >
      {panel === 'more' && objectId && <MoreMenu objectId={objectId} />}
      {object && isRemeshPlaceholder(object.root) && (
        <div className="panel flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-ink-dim">
          <span>The cube is only a placeholder; source topology is not rendered.</span>
          <button
            type="button"
            className="rounded bg-panel-3 px-2 py-1 text-ink hover:bg-panel-2"
            onClick={() => void keepHighMesh(object.id)}
          >
            Keep high mesh
          </button>
        </div>
      )}

      <div className="panel flex items-center gap-0.5 px-1.5 py-1">
        {object && hasMeshGeometry(object.root) && (
          <>
            <span className="px-1.5 text-[10px] tabular-nums text-ink-dim">
              {isRemeshPlaceholder(object.root)
                ? `Estimated source: ${formatTriangleCount(object.triangleCount ?? 0)}`
                : formatTriangleCount(object.triangleCount ?? 0)}
            </span>
            {!isRemeshPlaceholder(object.root) && (
              <div className="flex rounded-md bg-panel-2 p-0.5" aria-label="Asset display">
                <DisplayButton objectId={object.id} mode="solid" active={object.displayMode === 'solid'} />
                <DisplayButton
                  objectId={object.id}
                  mode="wireframe"
                  active={object.displayMode === 'wireframe'}
                />
              </div>
            )}
            <span className="mx-1 h-4 w-px bg-line" />
          </>
        )}
        <IconBtn
          title="Outliner"
          active={showOutliner}
          onClick={() => useEditorStore.getState().toggleOutliner()}
        >
          <ListIcon size={14} />
        </IconBtn>
        {!envSelected && (
          <IconBtn title="More" active={panel === 'more'} onClick={() => setPanel('more')}>
            <DotsIcon size={14} />
          </IconBtn>
        )}
        <span className="mx-1 h-4 w-px bg-line" />
        <IconBtn
          title="Move (W)"
          active={tool === 'select' && gizmoMode === 'translate'}
          onClick={() => {
            useEditorStore.getState().setTool('select')
            useEditorStore.getState().setGizmoMode('translate')
            useEditorStore.getState().setObjectBarPanel('none')
          }}
        >
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

function DisplayButton({
  objectId,
  mode,
  active,
}: {
  objectId: string
  mode: AssetDisplayMode
  active: boolean
}) {
  const label = mode === 'solid' ? 'Solid' : 'Wireframe'
  return (
    <button
      type="button"
      aria-label={`${label} display`}
      aria-pressed={active}
      onClick={() => useSceneStore.getState().setObjectDisplayMode(objectId, mode)}
      className={`rounded px-1.5 py-1 text-[10px] ${
        active ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:text-ink'
      }`}
    >
      {label}
    </button>
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

function MoreMenu({ objectId }: { objectId: string }) {
  const locked = useEditorStore((s) => s.lockedIds.includes(objectId))
  const falKey = useAgentStore((s) => s.falKey)
  const serverFal = useAgentStore((s) => s.serverKeys.fal)
  const canFal = Boolean(falKey.trim()) || serverFal
  const remeshJob = useSceneStore((s) => s.pendingLifts.find((lift) => lift.objectId === objectId))
  const object = useSceneStore((s) => s.objects.find((item) => item.id === objectId))
  const needsRetopo = !remeshJob && objectNeedsRetopo(objectId)
  const canKeepHighMesh =
    !remeshJob && Boolean(object?.bufferKey) && Boolean(object && isRemeshPlaceholder(object.root))
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
      {canKeepHighMesh && (
        <button
          type="button"
          className={item}
          onClick={() => {
            useEditorStore.getState().setObjectBarPanel('none')
            void keepHighMesh(objectId)
              .then(({ persisted }) =>
                useSceneStore
                  .getState()
                  .showNotice(
                    persisted
                      ? `"${object?.name ?? 'Model'}" kept as high mesh.`
                      : `"${object?.name ?? 'Model'}" kept as high mesh for this session — project storage is unavailable.`,
                  ),
              )
              .catch((error) =>
                useSceneStore
                  .getState()
                  .showNotice(error instanceof Error ? error.message : 'Could not load the high mesh.'),
              )
          }}
        >
          Keep high mesh
        </button>
      )}
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
