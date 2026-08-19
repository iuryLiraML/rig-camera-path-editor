import { useRef, type DragEvent } from 'react'
import { remeshSceneObject } from '../lib/meshJobs'
import { HEAVY_TRIANGLES, importDroppedModels } from '../lib/sceneIO'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { CubeIcon } from './icons'

export function denseImportCopy(name: string, triangles: number): string {
  const millions = triangles > HEAVY_TRIANGLES
  const label = millions
    ? `${(triangles / 1e6).toFixed(1)}M triangles — expect low FPS`
    : `${Math.round(triangles / 1000)}k triangles — retopology recommended`
  return `“${name}” is dense (${label}). Remesh with Tripo to a clay-friendly mesh, or keep the original.`
}

export function ImportAssetsModal() {
  const open = useEditorStore((s) => s.showImportModal)
  const queue = useEditorStore((s) => s.importRetopoQueue)
  const falKey = useAgentStore((s) => s.falKey)
  const serverFal = useAgentStore((s) => s.serverKeys.fal)
  const canFal = Boolean(falKey.trim()) || serverFal
  const inputRef = useRef<HTMLInputElement>(null)
  const heavy = queue[0] ?? null
  if (!open) return null

  const close = () => useEditorStore.getState().setShowImportModal(false)

  const advance = () => {
    const next = useEditorStore.getState().importRetopoQueue.slice(1)
    if (next.length === 0) useEditorStore.getState().setShowImportModal(false)
    else useEditorStore.getState().setImportRetopoQueue(next)
  }

  const takeFiles = async (files: File[]) => {
    const heavies = await importDroppedModels(files)
    if (heavies.length > 0) useEditorStore.getState().setImportRetopoQueue(heavies)
    else close()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    if (heavy) return
    void takeFiles([...e.dataTransfer.files])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        className="panel w-[min(92vw,420px)] p-5"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-sm font-semibold text-ink">{heavy ? 'Dense model' : 'Import Assets'}</h2>
          <button type="button" onClick={close} className="text-ink-dim hover:text-ink">
            ×
          </button>
        </div>

        {heavy ? (
          <HeavyStep
            heavy={heavy}
            remaining={queue.length}
            canFal={canFal}
            onKeep={advance}
            onRemesh={() => {
              const id = heavy.objectId
              advance()
              void remeshSceneObject(id)
            }}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-panel-2 px-6 py-10 text-center hover:bg-panel-3"
            >
              <CubeIcon size={28} />
              <span className="text-[12px] text-ink">Drag & Drop models or browse.</span>
              <span className="text-[10px] text-ink-dim">.glb, .gltf</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".glb,.gltf"
              multiple
              className="hidden"
              onChange={(e) => {
                void takeFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink hover:bg-panel-3"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/85"
              >
                Browse
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function HeavyStep({
  heavy,
  remaining,
  canFal,
  onKeep,
  onRemesh,
}: {
  heavy: { objectId: string; name: string; triangles: number }
  remaining: number
  canFal: boolean
  onKeep: () => void
  onRemesh: () => void
}) {
  return (
    <>
      <p className="mt-3 text-[12px] leading-relaxed text-ink">
        {denseImportCopy(heavy.name, heavy.triangles)}
      </p>
      {remaining > 1 && (
        <p className="mt-2 text-[11px] text-ink-dim">
          {remaining - 1} more dense {remaining === 2 ? 'model' : 'models'} after this one.
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onKeep}
          className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink hover:bg-panel-3"
        >
          Keep as-is
        </button>
        {canFal ? (
          <button
            type="button"
            onClick={onRemesh}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/85"
          >
            Remesh
          </button>
        ) : (
          <button
            type="button"
            onClick={() => useEditorStore.getState().setShowSettings(true)}
            className="rounded-lg bg-panel-2 px-3 py-1.5 text-xs text-ink hover:bg-panel-3"
          >
            Add Fal key in Settings
          </button>
        )}
      </div>
    </>
  )
}
