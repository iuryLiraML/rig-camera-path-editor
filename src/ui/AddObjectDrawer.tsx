import { useMemo, useRef, useState } from 'react'
import { PRIMITIVE_DEFS, PRIMITIVE_KINDS, type PrimitiveKind } from '../lib/primitiveGeometry'
import { generateObjectFromImage, generateObjectFromText } from '../lib/meshJobs'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { CubeIcon, ImportIcon, SearchIcon, WandIcon } from './icons'
import { GUTTER, directorDockSlot, useViewportInsets } from './viewportInsets'

type Chip = 'primitives' | 'assets' | 'generate'
type GenerateMode = 'pick' | 'text' | 'image'

function isStillImage(file: File) {
  if (file.type.startsWith('image/')) return true
  return /\.(jpe?g|png|webp)$/i.test(file.name)
}

export function AddObjectDrawer() {
  const objects = useSceneStore((s) => s.objects)
  const falKey = useAgentStore((s) => s.falKey)
  const serverFal = useAgentStore((s) => s.serverKeys.fal)
  const canFal = Boolean(falKey.trim()) || serverFal
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<Chip>('primitives')
  const [generateMode, setGenerateMode] = useState<GenerateMode>('pick')
  const [prompt, setPrompt] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const insets = useViewportInsets()
  const dock = directorDockSlot(insets)
  const q = query.trim().toLowerCase()

  const primitives = useMemo(
    () =>
      PRIMITIVE_KINDS.filter((kind) => PRIMITIVE_DEFS[kind].label.toLowerCase().includes(q)),
    [q],
  )
  const assets = objects.filter((object) => object.name.toLowerCase().includes(q) && object.bufferKey)

  return (
    <div
      className="panel absolute z-30 flex flex-col overflow-hidden"
      style={{
        left: insets.left,
        right: dock.right + dock.width + GUTTER,
        bottom: insets.contentBottom,
        height: 280,
      }}
    >
      <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2">
        <h2 className="shrink-0 text-[13px] font-semibold text-ink">Add an Object</h2>
        <button
          type="button"
          title="Import a .glb or .gltf"
          onClick={() => useEditorStore.getState().setShowImportModal(true)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-dim hover:bg-panel-2 hover:text-ink"
        >
          <ImportIcon size={12} />
          Import
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-panel-2 px-2 py-1.5">
          <SearchIcon className="shrink-0 text-ink-dim" size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for objects by name"
            className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-dim"
          />
        </div>
        <button
          type="button"
          title="Close"
          onClick={() => useEditorStore.getState().setShowAddDrawer(false)}
          className="rounded-md px-2 py-1 text-[13px] text-ink-dim hover:text-ink"
        >
          ×
        </button>
      </div>
      <div className="flex gap-1 px-3 pt-2">
        {(
          [
            { id: 'primitives', label: 'Primitives' },
            { id: 'assets', label: 'My assets' },
            { id: 'generate', label: 'Generate' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.id !== chip) setGenerateMode('pick')
              setChip(item.id)
            }}
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              chip === item.id ? 'bg-accent text-white' : 'bg-panel-2 text-ink-dim hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-3 py-3">
        {chip === 'primitives' ? (
          <div className="flex h-full gap-2">
            {primitives.map((kind) => (
              <PrimitiveTile key={kind} kind={kind} />
            ))}
            {primitives.length === 0 && (
              <p className="self-center text-[12px] text-ink-dim">No primitives match that search.</p>
            )}
          </div>
        ) : chip === 'assets' ? (
          <div className="flex h-full gap-2">
            {assets.map((object) => (
              <button
                key={object.id}
                type="button"
                onClick={() => {
                  useEditorStore.getState().select(`obj:${object.id}`)
                  useEditorStore.getState().setShowAddDrawer(false)
                }}
                className="flex h-full w-32 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3"
              >
                <div className="flex flex-1 items-center justify-center text-ink-dim">
                  <CubeIcon size={28} />
                </div>
                <span className="truncate text-[11px] text-ink">{object.name}</span>
              </button>
            ))}
            {assets.length === 0 && (
              <p className="self-center text-[12px] text-ink-dim">
                Imported .glb files land here. Use Import, or drop a file on the canvas.
              </p>
            )}
          </div>
        ) : (
          <GeneratePane
            canFal={canFal}
            mode={generateMode}
            prompt={prompt}
            image={image}
            onMode={setGenerateMode}
            onPrompt={setPrompt}
            onImage={setImage}
          />
        )}
      </div>
    </div>
  )
}

function GeneratePane({
  canFal,
  mode,
  prompt,
  image,
  onMode,
  onPrompt,
  onImage,
}: {
  canFal: boolean
  mode: GenerateMode
  prompt: string
  image: File | null
  onMode: (mode: GenerateMode) => void
  onPrompt: (value: string) => void
  onImage: (file: File | null) => void
}) {
  const imageRef = useRef<HTMLInputElement>(null)

  if (mode === 'text') {
    return (
      <div className="flex h-full flex-col gap-2">
        <button
          type="button"
          onClick={() => onMode('pick')}
          className="self-start text-[11px] text-ink-dim hover:text-ink"
        >
          ← Back
        </button>
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && prompt.trim()) {
              e.preventDefault()
              void generateObjectFromText(prompt)
            }
          }}
          placeholder="A clay house with a pitched roof"
          className="min-h-0 flex-1 resize-none rounded-md bg-panel-2 px-2 py-1.5 text-[12px] text-ink outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-ink-dim">Ctrl+Enter to generate</span>
          <button
            type="button"
            disabled={!prompt.trim()}
            onClick={() => void generateObjectFromText(prompt)}
            className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/85 disabled:opacity-40"
          >
            Generate
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'image') {
    return (
      <div className="flex h-full flex-col gap-2">
        <button
          type="button"
          onClick={() => onMode('pick')}
          className="self-start text-[11px] text-ink-dim hover:text-ink"
        >
          ← Back
        </button>
        <p className="text-[10px] text-ink-dim">
          Use a photo of the object alone. To lift one thing out of a scene, attach the photo in
          Director.
        </p>
        <button
          type="button"
          onClick={() => imageRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files[0]
            if (file && isStillImage(file)) onImage(file)
          }}
          className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel-2 text-[11px] text-ink-dim hover:bg-panel-3"
        >
          {image ? image.name : 'Drop or browse a photo'}
        </button>
        <input
          ref={imageRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null
            onImage(file && isStillImage(file) ? file : null)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          disabled={!image}
          onClick={() => image && void generateObjectFromImage(image)}
          className="self-end rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/85 disabled:opacity-40"
        >
          Generate
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {!canFal && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-ink-dim">Add your Fal API key in Settings</p>
          <button
            type="button"
            onClick={() => useEditorStore.getState().setShowSettings(true)}
            className="shrink-0 rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink hover:bg-panel-3"
          >
            Open Settings
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-2">
        <button
          type="button"
          disabled={!canFal}
          onClick={() => onMode('text')}
          className="flex h-full w-36 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-ink-dim">
            <WandIcon size={22} />
            <span className="text-[11px]">From text</span>
          </div>
          <span className="truncate text-[11px] text-ink">Tripo H3.1</span>
          <span className="truncate text-[10px] text-ink-dim">Describe a clay object</span>
        </button>
        <button
          type="button"
          disabled={!canFal}
          onClick={() => onMode('image')}
          className="flex h-full w-36 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-ink-dim">
            <ImportIcon size={22} />
            <span className="text-[11px]">From image</span>
          </div>
          <span className="truncate text-[11px] text-ink">Meshy v7</span>
          <span className="truncate text-[10px] text-ink-dim">Photo of the object alone</span>
        </button>
      </div>
    </div>
  )
}

function PrimitiveTile({ kind }: { kind: PrimitiveKind }) {
  return (
    <button
      type="button"
      onClick={() => {
        useSceneStore.getState().addPrimitive(kind)
        useEditorStore.getState().setShowAddDrawer(false)
      }}
      className="flex h-full w-32 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3"
    >
      <div className="flex flex-1 items-center justify-center text-ink-dim">
        <CubeIcon size={28} />
      </div>
      <span className="truncate text-[11px] text-ink">{PRIMITIVE_DEFS[kind].label}</span>
    </button>
  )
}
