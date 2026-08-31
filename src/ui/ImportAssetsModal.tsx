import { useRef, type DragEvent } from 'react'
import { importDroppedSceneFiles } from '../lib/sceneIO'
import { useEditorStore } from '../state/useEditorStore'
import { CubeIcon } from './icons'

export function ImportAssetsModal() {
  const open = useEditorStore((s) => s.showImportModal)
  const inputRef = useRef<HTMLInputElement>(null)
  if (!open) return null

  const close = () => useEditorStore.getState().setShowImportModal(false)

  const takeFiles = async (files: File[]) => {
    await importDroppedSceneFiles(files)
    close()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
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
          <h2 className="text-sm font-semibold text-ink">Import Assets</h2>
          <button type="button" onClick={close} className="text-ink-dim hover:text-ink">
            ×
          </button>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-panel-2 px-6 py-10 text-center hover:bg-panel-3"
        >
          <CubeIcon size={28} />
          <span className="text-[12px] text-ink">Drag & Drop models or browse.</span>
          <span className="text-[10px] text-ink-dim">.glb, .gltf, .obj, .ply, .splat</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".glb,.gltf,.obj,.ply,.splat"
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
      </div>
    </div>
  )
}
