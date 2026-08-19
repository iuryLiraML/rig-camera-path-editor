import { useEffect, useState } from 'react'
import { loadShot, playAnimatic, saveCurrentAsShot } from '../lib/projects'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore, type Shot } from '../state/useProjectStore'
import { CameraIcon, PlayIcon, PlusIcon } from './icons'
import { GUTTER, useViewportInsets } from './viewportInsets'
import { ComposeDockTabs } from './ComposeDockTabs'

export function SequenceStrip() {
  const shots = useProjectStore((s) => s.shots)
  const insets = useViewportInsets()
  const ordered = [...shots].sort((a, b) => a.order - b.order)

  return (
    <div
      className="panel absolute z-20 flex flex-col overflow-hidden"
      style={{
        left: insets.left,
        width: insets.right - insets.left,
        bottom: GUTTER,
        height: insets.timelineHeight,
      }}
    >
      <div className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5">
        <ComposeDockTabs />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void saveCurrentAsShot()}
            className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent/85"
          >
            <PlusIcon size={11} />
            Add a Shot
          </button>
          <button
            type="button"
            disabled={ordered.length === 0}
            onClick={() => void playAnimatic()}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink hover:bg-panel-2 disabled:cursor-not-allowed disabled:text-ink-dim/50"
          >
            <PlayIcon size={11} />
            Play animatic
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto px-3 py-2">
        {ordered.length === 0 ? (
          <p className="self-center text-[11px] text-ink-dim">
            No shots yet. Frame a camera move, then press Add a Shot.
          </p>
        ) : (
          ordered.map((shot, index) => <ShotThumb key={shot.id} shot={shot} index={index} />)
        )}
      </div>
    </div>
  )
}

function ShotThumb({ shot, index }: { shot: Shot; index: number }) {
  const active = useEditorStore((s) => s.activeShotId === shot.id)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!shot.thumbnail) return
    const next = URL.createObjectURL(shot.thumbnail)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [shot.thumbnail])

  return (
    <div
      className={`group relative flex h-full w-36 shrink-0 flex-col overflow-hidden rounded-lg text-left ${
        active ? 'bg-panel-3 ring-1 ring-accent' : 'bg-panel-2 hover:bg-panel-3'
      }`}
    >
      <button
        type="button"
        title="Open this shot"
        onClick={() => loadShot(shot)}
        className="flex min-h-0 flex-1 flex-col text-left"
      >
        <div className="relative min-h-0 flex-1 bg-black/30">
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-ink-dim">
              <CameraIcon size={16} />
            </div>
          )}
          <span className="absolute left-1 top-1 rounded bg-black/50 px-1 text-[9px] text-white">
            Shot {index + 1}
          </span>
          <span className="absolute bottom-1 right-1 rounded bg-black/50 px-1 text-[9px] text-white">
            {shot.duration.toFixed(1)}s
          </span>
        </div>
        <span className="truncate px-1.5 py-1 text-[10px] text-ink">{shot.name}</span>
      </button>
      <button
        type="button"
        title="Delete shot"
        onClick={(e) => {
          e.stopPropagation()
          const remaining = useProjectStore.getState().shots.filter((item) => item.id !== shot.id)
          useProjectStore.getState().removeShot(shot.id)
          const editor = useEditorStore.getState()
          if (editor.activeShotId === shot.id) {
            editor.setActiveShotId(remaining[remaining.length - 1]?.id ?? null)
          }
        }}
        className="absolute right-1 top-1 hidden rounded bg-black/60 px-1 text-[11px] leading-none text-white group-hover:block hover:text-red-300"
      >
        ×
      </button>
    </div>
  )
}
