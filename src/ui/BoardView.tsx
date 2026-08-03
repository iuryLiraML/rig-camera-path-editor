import { useEffect, useState } from 'react'
import { useProjectStore, type Shot } from '../state/useProjectStore'
import { useEditorStore } from '../state/useEditorStore'
import { loadShot, playAnimatic } from '../lib/projects'
import { PlayIcon } from './icons'

function ShotCard({
  shot,
  index,
  onDragState,
}: {
  shot: Shot
  index: number
  onDragState: (dragging: boolean) => void
}) {
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
      onDragStart={(e) => {
        e.dataTransfer.setData('text/shot-id', shot.id)
        onDragState(true)
      }}
      onDragEnd={() => onDragState(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const dragged = e.dataTransfer.getData('text/shot-id')
        if (dragged && dragged !== shot.id) project.moveShot(dragged, shot.id)
      }}
      className="panel group cursor-grab overflow-hidden active:cursor-grabbing"
    >
      <button
        type="button"
        onClick={() => loadShot(shot)}
        title="Open this shot in the editor"
        className="relative block aspect-video w-full bg-panel-2 text-left"
      >
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
        {/* the card is draggable, so say what a click does instead of leaving a
            full-width blue button eating a third of the card */}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          Open in editor
        </span>
      </button>
      <div className="space-y-1.5 p-2.5">
        <input
          value={shot.name}
          onChange={(e) => project.updateShot(shot.id, { name: e.target.value })}
          className="w-full bg-transparent text-[12px] font-medium text-ink outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-ink-dim">
            {shot.duration.toFixed(1)}s · {formatLabel}
          </span>
          <button
            onClick={() => project.removeShot(shot.id)}
            title="Delete shot"
            className="rounded px-1 text-[12px] leading-none text-ink-dim opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
          >
            &#215;
          </button>
        </div>
      </div>
    </div>
  )
}

export function BoardView() {
  const shots = useProjectStore((s) => s.shots)
  const projectName = useProjectStore((s) => s.name)
  // the end-of-board drop target used to sit there permanently as a dashed
  // 64 px sliver — it read as a broken card. Show it only while dragging.
  const [dragging, setDragging] = useState(false)

  const ordered = [...shots].sort((a, b) => a.order - b.order)
  const totalSeconds = ordered.reduce((sum, s) => sum + s.duration, 0)

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-[#0f0f11]">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-ink">{projectName}</h1>
          <span className="text-[11px] text-ink-dim">
            {ordered.length} {ordered.length === 1 ? 'shot' : 'shots'} ·{' '}
            {totalSeconds.toFixed(1)}s
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
          <div className="panel mt-8 flex flex-col items-center gap-3 px-8 py-14 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-panel-2 text-ink-dim">
              <PlayIcon size={14} />
            </div>
            <h2 className="text-sm font-medium text-ink">No shots yet</h2>
            <p className="max-w-sm text-[12px] leading-5 text-ink-dim">
              A shot is a camera move you saved. Build one in the editor, then press
              <span className="text-ink"> Save shot</span> on the timeline — they line up here as an
              animatic.
            </p>
            <button
              onClick={() => useEditorStore.getState().setAppView('editor')}
              className="mt-1 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/85"
            >
              Go to the editor
            </button>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {ordered.map((shot, i) => (
              <ShotCard key={shot.id} shot={shot} index={i} onDragState={setDragging} />
            ))}
            {/* drop at the end */}
            {dragging && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const dragged = e.dataTransfer.getData('text/shot-id')
                if (dragged) useProjectStore.getState().moveShot(dragged, null)
                setDragging(false)
              }}
              title="Drop a shot here to move it to the end"
              className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-line/60 text-[11px] text-ink-dim transition-colors hover:border-accent/60 hover:text-ink"
            >
              Move to the end
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
