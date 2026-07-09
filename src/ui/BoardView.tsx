import { useEffect, useRef, useState } from 'react'
import { useProjectStore, type Shot } from '../state/useProjectStore'
import { useEditorStore } from '../state/useEditorStore'
import { loadShot, playAnimatic } from '../lib/projects'
import { PlayIcon } from './icons'

function ShotCard({ shot, index }: { shot: Shot; index: number }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const project = useProjectStore.getState()

  useEffect(() => {
    if (!shot.thumbnail) return
    const url = URL.createObjectURL(shot.thumbnail)
    setThumbUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [shot.thumbnail])

  const formatLabel =
    shot.format.res === 'custom'
      ? `${shot.format.custom[0]}×${shot.format.custom[1]}`
      : `${shot.format.aspect} · ${shot.format.res}p`

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/shot-id', shot.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const dragged = e.dataTransfer.getData('text/shot-id')
        if (dragged && dragged !== shot.id) project.moveShot(dragged, shot.id)
      }}
      className="panel group w-60 cursor-grab overflow-hidden active:cursor-grabbing"
    >
      <div className="relative aspect-video bg-panel-2">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-ink-dim">
            no preview
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] tabular-nums text-white">
          {String((index + 1) * 10).padStart(3, '0')}
        </span>
      </div>
      <div className="space-y-1.5 p-2.5">
        <input
          value={shot.name}
          onChange={(e) => project.updateShot(shot.id, { name: e.target.value })}
          className="w-full bg-transparent text-[12px] font-medium text-ink outline-none"
        />
        <div className="text-[10px] text-ink-dim">
          {shot.duration.toFixed(1)}s · {formatLabel}
        </div>
        <div className="flex gap-1.5 pt-0.5">
          <button
            onClick={() => loadShot(shot)}
            className="flex-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent/85"
          >
            Open in editor
          </button>
          <button
            onClick={() => project.removeShot(shot.id)}
            title="Delete shot"
            className="rounded-md bg-panel-2 px-2 py-1 text-[11px] text-red-400 hover:bg-panel-3"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

export function BoardView() {
  const shots = useProjectStore((s) => s.shots)
  const projectName = useProjectStore((s) => s.name)
  const endDropRef = useRef<HTMLDivElement>(null)

  const ordered = [...shots].sort((a, b) => a.order - b.order)
  const totalSeconds = ordered.reduce((sum, s) => sum + s.duration, 0)

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-[#0f0f11]">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-ink">{projectName}</h1>
          <span className="text-[11px] text-ink-dim">
            {ordered.length} shots · {totalSeconds.toFixed(1)}s
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => void playAnimatic()}
              disabled={ordered.length === 0}
              className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/85 disabled:cursor-not-allowed disabled:bg-panel-3 disabled:text-ink-dim/60"
            >
              <PlayIcon size={11} />
              Play animatic
            </button>
            <button
              onClick={() => useEditorStore.getState().setAppView('editor')}
              className="rounded-md bg-panel-2 px-3 py-1.5 text-[12px] text-ink hover:bg-panel-3"
            >
              Back to editor
            </button>
          </div>
        </div>

        {ordered.length === 0 ? (
          <div className="mt-24 text-center text-[13px] leading-relaxed text-ink-dim">
            No shots yet.
            <br />
            Build a camera move in the editor and press{' '}
            <span className="text-ink">Save shot</span> on the timeline.
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap gap-4">
            {ordered.map((shot, i) => (
              <ShotCard key={shot.id} shot={shot} index={i} />
            ))}
            {/* drop at the end */}
            <div
              ref={endDropRef}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const dragged = e.dataTransfer.getData('text/shot-id')
                if (dragged) useProjectStore.getState().moveShot(dragged, null)
              }}
              className="w-16 rounded-lg border border-dashed border-line/60"
            />
          </div>
        )}
      </div>
    </div>
  )
}
