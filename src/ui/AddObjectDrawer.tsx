import { useMemo, useRef, useState, type ReactNode } from 'react'
import { PRIMITIVE_DEFS, PRIMITIVE_KINDS, type PrimitiveKind } from '../lib/primitiveGeometry'
import {
  generateObjectFromImage,
  generateObjectFromText,
  generateSamAlign,
  generateSamBody,
  generateSamObject,
  generatePointCloudFromViews,
} from '../lib/meshJobs'
import { addDummyToSceneWhenReady, type FigureSex } from '../lib/dummyCharacter'
import {
  assignStoredEnvironment,
  clearActiveEnvironment,
  deleteStoredEnvironment,
  generateEnvironmentFromPhoto,
  importEnvironmentFile,
  instantiateUnplaced,
} from '../lib/environmentJobs'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { ClapperIcon, CubeIcon, FrameIcon, GlobeIcon, ImportIcon, PersonIcon, SearchIcon, WandIcon } from './icons'
import { FigurePreview, PrimitivePreview } from './PrimitivePreview'
import { ADD_DRAWER_HEIGHT, GUTTER, directorDockSlot, useViewportInsets } from './viewportInsets'
import {
  approveFindRows,
  detectObjectRows,
  detectPeopleRows,
  makeFindRow,
  takeFindSeedRows,
  type FindRow,
} from '../lib/findObjects'
import { clearSceneBlockSession, commitSceneBlock, getSceneBlockSession } from '../lib/sceneBlock'
import { VGGT_MAX_VIEWS } from '../lib/fal/vggt'

type GenerateMode = 'pick' | 'text' | 'image' | 'body' | 'object' | 'align' | 'views'

function isStillImage(file: File) {
  if (file.type.startsWith('image/')) return true
  return /\.(jpe?g|png|webp)$/i.test(file.name)
}

export function AddObjectDrawer() {
  const objects = useSceneStore((s) => s.objects)
  const unplaced = useEnvironmentStore((s) => s.unplacedAssets)
  const environments = useEnvironmentStore((s) => s.environments)
  const environmentId = useEnvironmentStore((s) => s.environmentId)
  const findOpen = useEnvironmentStore((s) => s.findOpen)
  const falKey = useAgentStore((s) => s.falKey)
  const serverFal = useAgentStore((s) => s.serverKeys.fal)
  const canFal = Boolean(falKey.trim()) || serverFal
  const [query, setQuery] = useState('')
  const chip = useEditorStore((s) => s.addDrawerChip)
  const [generateMode, setGenerateMode] = useState<GenerateMode>('pick')
  const [prompt, setPrompt] = useState('')
  const [objectNoun, setObjectNoun] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [views, setViews] = useState<File[]>([])
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
    <>
    <div
      className="panel absolute z-30 flex flex-col overflow-hidden"
      style={{
        left: insets.left,
        right: dock.right + dock.width + GUTTER,
        bottom: insets.bottom + GUTTER,
        height: ADD_DRAWER_HEIGHT,
      }}
    >
      <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2">
        <h2 className="shrink-0 text-[13px] font-semibold text-ink">Add an Object</h2>
        <button
          type="button"
          title="Import a .glb, .gltf, or .obj"
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
      </div>
      <div className="flex gap-1 px-3 pt-2">
        {(
          [
            { id: 'primitives', label: 'Primitives' },
            { id: 'assets', label: 'My assets' },
            { id: 'generate', label: 'Generate' },
            { id: 'environment', label: 'Environment' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.id !== chip) setGenerateMode('pick')
              useEditorStore.getState().setAddDrawerChip(item.id)
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
            {(!q || figureSearchHit(q, 'female')) && <FigureTile sex="female" />}
            {(!q || figureSearchHit(q, 'male')) && <FigureTile sex="male" />}
            {primitives.map((kind) => (
              <PrimitiveTile key={kind} kind={kind} />
            ))}
            {primitives.length === 0 && q && !figureSearchHit(q, 'female') && !figureSearchHit(q, 'male') && (
              <p className="self-center text-[12px] text-ink-dim">No primitives match that search.</p>
            )}
          </div>
        ) : chip === 'assets' ? (
          <AssetsPane query={q} unplaced={unplaced} placed={assets} />
        ) : chip === 'environment' ? (
          <EnvironmentPane canFal={canFal} environments={environments} environmentId={environmentId} />
        ) : (
          <GeneratePane
            canFal={canFal}
            mode={generateMode}
            prompt={prompt}
            objectNoun={objectNoun}
            image={image}
            views={views}
            onMode={setGenerateMode}
            onPrompt={setPrompt}
            onObjectNoun={setObjectNoun}
            onImage={setImage}
            onViews={setViews}
          />
        )}
      </div>
    </div>
    {findOpen && <FindObjectsPanel />}
    </>
  )
}

function GeneratePane({
  canFal,
  mode,
  prompt,
  objectNoun,
  image,
  views,
  onMode,
  onPrompt,
  onObjectNoun,
  onImage,
  onViews,
}: {
  canFal: boolean
  mode: GenerateMode
  prompt: string
  objectNoun: string
  image: File | null
  views: File[]
  onMode: (mode: GenerateMode) => void
  onPrompt: (value: string) => void
  onObjectNoun: (value: string) => void
  onImage: (file: File | null) => void
  onViews: (files: File[]) => void
}) {
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
      <GenerateStillPane
        hint="JPEG or PNG of the object alone — not a room. Lands in Unplaced."
        image={image}
        onImage={onImage}
        onBack={() => onMode('pick')}
        submitLabel="Generate"
        disabled={!image}
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
        onSubmit={() => image && void generateObjectFromImage(image)}
      />
    )
  }

  if (mode === 'body') {
    return (
      <GenerateStillPane
        hint="Photo of a person. SAM 3.0 reconstructs a textured body. Switch Visualize to Clay to gray it."
        image={image}
        onImage={onImage}
        onBack={() => onMode('pick')}
        submitLabel="Generate body"
        disabled={!image}
        onSubmit={() => image && void generateSamBody(image)}
      />
    )
  }

  if (mode === 'object') {
    return (
      <GenerateStillPane
        hint="Type the noun (chair, lamp). SAM 3.0 reconstructs a textured mesh. Clay mode grays it later."
        image={image}
        onImage={onImage}
        onBack={() => onMode('pick')}
        submitLabel="Generate object"
        disabled={!image || !objectNoun.trim()}
        extra={<ObjectNounField value={objectNoun} onChange={onObjectNoun} />}
        onSubmit={() => image && void generateSamObject(image, objectNoun)}
      />
    )
  }

  if (mode === 'align') {
    return (
      <GenerateStillPane
        hint="Photo of a person in a scene. Optional noun also lifts that prop and asks for scene_glb."
        image={image}
        onImage={onImage}
        onBack={() => onMode('pick')}
        submitLabel="Align in photo"
        disabled={!image}
        extra={<ObjectNounField value={objectNoun} onChange={onObjectNoun} />}
        onSubmit={() => image && void generateSamAlign(image, objectNoun)}
      />
    )
  }

  if (mode === 'views') {
    return (
      <GenerateViewsPane
        files={views}
        onFiles={onViews}
        onBack={() => onMode('pick')}
        onSubmit={() => void generatePointCloudFromViews(views)}
      />
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
          <span className="truncate text-[10px] text-ink-dim">Lands in Unplaced</span>
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
          <span className="truncate text-[10px] text-ink-dim">Photo → Unplaced</span>
        </button>
        <button
          type="button"
          disabled={!canFal}
          onClick={() => onMode('body')}
          className="flex h-full w-36 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-ink-dim">
            <PersonIcon size={22} />
            <span className="text-[11px]">3D Body</span>
          </div>
          <span className="truncate text-[11px] text-ink">SAM 3.0</span>
          <span className="truncate text-[10px] text-ink-dim">Photo → Unplaced</span>
        </button>
        <button
          type="button"
          disabled={!canFal}
          onClick={() => onMode('object')}
          className="flex h-full w-36 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-ink-dim">
            <CubeIcon size={22} />
            <span className="text-[11px]">3D Object</span>
          </div>
          <span className="truncate text-[11px] text-ink">SAM 3.0</span>
          <span className="truncate text-[10px] text-ink-dim">Name the object</span>
        </button>
        <button
          type="button"
          disabled={!canFal}
          onClick={() => onMode('align')}
          className="flex h-full w-36 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-ink-dim">
            <ClapperIcon size={22} />
            <span className="text-[11px]">3D Align</span>
          </div>
          <span className="truncate text-[11px] text-ink">SAM 3.0</span>
          <span className="truncate text-[10px] text-ink-dim">Body + optional prop</span>
        </button>
        <button
          type="button"
          disabled={!canFal}
          onClick={() => onMode('views')}
          className="flex h-full w-36 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-ink-dim">
            <FrameIcon size={22} />
            <span className="text-[11px]">From views</span>
          </div>
          <span className="truncate text-[11px] text-ink">VGGT-1B</span>
          <span className="truncate text-[10px] text-ink-dim">Cloud → Unplaced</span>
        </button>
      </div>
    </div>
  )
}

function ObjectNounField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="chair, lamp, guitar…"
      className="rounded-md bg-panel-2 px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-dim"
    />
  )
}

function GenerateStillPane({
  hint,
  image,
  onImage,
  onBack,
  submitLabel,
  disabled,
  onSubmit,
  extra,
  accept = 'image/jpeg,image/png,image/webp',
}: {
  hint: string
  image: File | null
  onImage: (file: File | null) => void
  onBack: () => void
  submitLabel: string
  disabled: boolean
  onSubmit: () => void
  extra?: ReactNode
  accept?: string
}) {
  const imageRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex h-full flex-col gap-2">
      <button type="button" onClick={onBack} className="self-start text-[11px] text-ink-dim hover:text-ink">
        ← Back
      </button>
      <p className="text-[10px] text-ink-dim">{hint}</p>
      {extra}
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
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null
          onImage(file && isStillImage(file) ? file : null)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={onSubmit}
        className="self-end rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/85 disabled:opacity-40"
      >
        {submitLabel}
      </button>
    </div>
  )
}

function GenerateViewsPane({
  files,
  onFiles,
  onBack,
  onSubmit,
}: {
  files: File[]
  onFiles: (files: File[]) => void
  onBack: () => void
  onSubmit: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function takeStills(list: FileList | File[]) {
    const next = [...files]
    for (const file of Array.from(list)) {
      if (!isStillImage(file)) continue
      if (next.length >= VGGT_MAX_VIEWS) break
      next.push(file)
    }
    onFiles(next)
  }

  const label =
    files.length === 0
      ? `Drop or browse overlapping photos (up to ${VGGT_MAX_VIEWS})`
      : files.length === 1
        ? files[0]!.name
        : `${files.length} stills`

  return (
    <div className="flex h-full flex-col gap-2">
      <button type="button" onClick={onBack} className="self-start text-[11px] text-ink-dim hover:text-ink">
        ← Back
      </button>
      <p className="text-[10px] text-ink-dim">
        Several overlapping photos of the same place. Parks a colored point cloud in Unplaced — not the palco,
        not a camera path.
      </p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          takeStills(e.dataTransfer.files)
        }}
        className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel-2 px-2 text-[11px] text-ink-dim hover:bg-panel-3"
      >
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) takeStills(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="flex items-center justify-between gap-2">
        {files.length > 0 ? (
          <button type="button" onClick={() => onFiles([])} className="text-[11px] text-ink-dim hover:text-ink">
            Clear stills
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={files.length === 0}
          onClick={onSubmit}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/85 disabled:opacity-40"
        >
          Reconstruct
        </button>
      </div>
    </div>
  )
}

function figureSearchHit(query: string, sex: FigureSex) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const keys = ['dummy', 'figure', 'person', sex, sex === 'female' ? 'woman' : 'man']
  return keys.some((key) => key.includes(q) || q.includes(key))
}

function FigureTile({ sex }: { sex: FigureSex }) {
  const label = sex === 'female' ? 'Female' : 'Male'
  return (
    <button
      type="button"
      data-primitive={sex}
      onClick={() => void addDummyToSceneWhenReady(sex)}
      className="group flex h-full w-28 shrink-0 flex-col items-center rounded-xl bg-panel-2 px-2 pb-2 pt-3 text-left hover:bg-panel-3"
    >
      <div className="flex h-[4.75rem] w-[4.75rem] items-center justify-center overflow-hidden rounded-lg bg-black/25 transition-transform duration-150 group-hover:scale-[1.03]">
        <FigurePreview sex={sex} />
      </div>
      <span className="mt-auto truncate text-[11px] text-ink">{label}</span>
    </button>
  )
}

function AssetsPane({
  query,
  unplaced,
  placed,
}: {
  query: string
  unplaced: { id: string; name: string }[]
  placed: { id: string; name: string }[]
}) {
  const shelf = unplaced.filter((asset) => asset.name.toLowerCase().includes(query))
  return (
    <div className="flex h-full gap-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-dim">Unplaced</span>
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto">
          {shelf.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => void instantiateUnplaced(asset.id)}
              className="flex h-full w-32 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3"
            >
              <div className="flex flex-1 items-center justify-center text-ink-dim">
                <CubeIcon size={28} />
              </div>
              <span className="truncate text-[11px] text-ink">{asset.name}</span>
            </button>
          ))}
          {shelf.length === 0 && (
            <p className="self-center text-[12px] text-ink-dim">Generated people and props land here first.</p>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-dim">In this scene</span>
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto">
          {placed.map((object) => (
            <button
              key={object.id}
              type="button"
              onClick={() => useEditorStore.getState().select(`obj:${object.id}`)}
              className="flex h-full w-32 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3"
            >
              <div className="flex flex-1 items-center justify-center text-ink-dim">
                <CubeIcon size={28} />
              </div>
              <span className="truncate text-[11px] text-ink">{object.name}</span>
            </button>
          ))}
          {placed.length === 0 && (
            <p className="self-center text-[12px] text-ink-dim">Nothing placed yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function EnvironmentPane({
  canFal,
  environments,
  environmentId,
}: {
  canFal: boolean
  environments: { id: string; name: string }[]
  environmentId: string | null
}) {
  const photoRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const sourceImage = useEnvironmentStore((s) => s.sourceImage)

  return (
    <div className="flex h-full gap-2">
      <button
        type="button"
        disabled={!canFal}
        onClick={() => photoRef.current?.click()}
        className="flex h-full w-36 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-ink-dim">
          <GlobeIcon size={22} />
          <span className="text-[11px]">From photo</span>
        </div>
        <span className="truncate text-[11px] text-ink">TripoSplat</span>
        <span className="truncate text-[10px] text-ink-dim">Set the scene palco</span>
      </button>
      <input
        ref={photoRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void generateEnvironmentFromPhoto(file)
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex h-full w-36 shrink-0 flex-col rounded-xl bg-panel-2 p-2 text-left hover:bg-panel-3"
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-ink-dim">
          <ImportIcon size={22} />
          <span className="text-[11px]">Import</span>
        </div>
        <span className="truncate text-[11px] text-ink">.ply / .splat</span>
        <span className="truncate text-[10px] text-ink-dim">Library of this project</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".ply,.splat,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void importEnvironmentFile(file)
        }}
      />
      {environments.map((environment) => (
        <div key={environment.id} className="flex h-full w-36 shrink-0 flex-col rounded-xl bg-panel-2 p-2">
          <button
            type="button"
            onClick={() => assignStoredEnvironment(environment.id)}
            className={`min-h-0 flex-1 truncate rounded-md px-1 text-left text-[11px] hover:bg-panel-3 ${
              environment.id === environmentId ? 'text-accent' : 'text-ink'
            }`}
          >
            {environment.name}
          </button>
          <button
            type="button"
            className="text-[10px] text-ink-dim hover:text-ink"
            onClick={() => deleteStoredEnvironment(environment.id)}
          >
            Delete
          </button>
        </div>
      ))}
      {environmentId && (
        <button
          type="button"
          onClick={() => clearActiveEnvironment()}
          className="self-center rounded-md px-2 py-1 text-[11px] text-ink-dim hover:bg-panel-3 hover:text-ink"
        >
          Clear environment
        </button>
      )}
      {sourceImage && environmentId && (
        <button
          type="button"
          onClick={() => {
            const env = useEnvironmentStore.getState()
            env.setFindPlaceMode('unplaced')
            env.setFindOpen(true)
          }}
          className="self-center rounded-md bg-accent px-2 py-1 text-[11px] text-white hover:bg-accent/85"
        >
          Find objects…
        </button>
      )}
    </div>
  )
}

function PrimitiveTile({ kind }: { kind: PrimitiveKind }) {
  return (
    <button
      type="button"
      data-primitive={kind}
      onClick={() => {
        useSceneStore.getState().addPrimitive(kind)
      }}
      className="group flex h-full w-28 shrink-0 flex-col items-center rounded-xl bg-panel-2 px-2 pb-2 pt-3 text-left hover:bg-panel-3"
    >
      <div className="flex h-[4.75rem] w-[4.75rem] items-center justify-center overflow-hidden rounded-lg bg-black/25 transition-transform duration-150 group-hover:scale-[1.03]">
        <PrimitivePreview kind={kind} />
      </div>
      <span className="mt-auto truncate text-[11px] text-ink">{PRIMITIVE_DEFS[kind].label}</span>
    </button>
  )
}

function FindObjectsPanel() {
  const sourceImage = useEnvironmentStore((s) => s.sourceImage)
  const findPlaceMode = useEnvironmentStore((s) => s.findPlaceMode)
  const blocking = findPlaceMode === 'scene'
  const [rows, setRows] = useState<FindRow[]>(() =>
    blocking ? (getSceneBlockSession()?.rows ?? []) : takeFindSeedRows(),
  )
  const [busy, setBusy] = useState(false)
  const [objectNoun, setObjectNoun] = useState('')

  return (
    <div className="panel absolute z-40 flex max-h-64 flex-col gap-2 p-3" style={{ right: 24, bottom: 220, width: 280 }}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-ink">{blocking ? 'Block this scene' : 'Find objects'}</span>
        <button
          type="button"
          className="text-ink-dim hover:text-ink"
          onClick={() => {
            if (blocking) clearSceneBlockSession()
            useEnvironmentStore.getState().setFindOpen(false)
          }}
        >
          ×
        </button>
      </div>
      <p className="text-[10px] text-ink-dim">
        {blocking
          ? 'Confirm uses these masks. Location stays on the Environment chip.'
          : 'People and props only. Floor and walls stay in the splat.'}
      </p>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-1">
            <span className="w-16 shrink-0 text-[10px] uppercase text-ink-dim">{row.kind}</span>
            <input
              value={row.name}
              onChange={(e) =>
                setRows((current) => current.map((item) => (item.id === row.id ? { ...item, name: e.target.value } : item)))
              }
              className="min-w-0 flex-1 rounded bg-panel-2 px-1 py-0.5 text-[11px] text-ink outline-none"
            />
            <button type="button" className="text-[10px] text-ink-dim" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {!blocking && (
          <>
            <button
              type="button"
              className="rounded bg-panel-2 px-2 py-1 text-[10px] text-ink hover:bg-panel-3"
              onClick={() => setRows((current) => [...current, makeFindRow('person', 'Person')])}
            >
              + Person
            </button>
            <button
              type="button"
              className="rounded bg-panel-2 px-2 py-1 text-[10px] text-ink hover:bg-panel-3"
              onClick={() => setRows((current) => [...current, makeFindRow('object', 'Object')])}
            >
              + Object
            </button>
            <button
              type="button"
              disabled={!sourceImage || busy}
              className="rounded bg-panel-2 px-2 py-1 text-[10px] text-ink hover:bg-panel-3 disabled:opacity-40"
              onClick={() => {
                if (!sourceImage) return
                setBusy(true)
                void detectPeopleRows(sourceImage)
                  .then((people) => setRows((current) => [...current, ...people]))
                  .finally(() => setBusy(false))
              }}
            >
              Detect people
            </button>
            <input
              value={objectNoun}
              onChange={(e) => setObjectNoun(e.target.value)}
              placeholder="noun"
              className="w-16 rounded bg-panel-2 px-1 py-1 text-[10px] text-ink outline-none placeholder:text-ink-dim"
            />
            <button
              type="button"
              disabled={!sourceImage || busy}
              className="rounded bg-panel-2 px-2 py-1 text-[10px] text-ink hover:bg-panel-3 disabled:opacity-40"
              onClick={() => {
                if (!sourceImage) return
                setBusy(true)
                void detectObjectRows(sourceImage, { prompt: objectNoun || undefined })
                  .then((objects) => setRows((current) => [...current, ...objects]))
                  .finally(() => setBusy(false))
              }}
            >
              Detect objects
            </button>
            <button
              type="button"
              disabled={busy || rows.length === 0}
              className="rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-40"
              onClick={() => {
                setBusy(true)
                void approveFindRows(rows, sourceImage).finally(() => setBusy(false))
              }}
            >
              Queue to Unplaced
            </button>
          </>
        )}
        {blocking && (
          <button
            type="button"
            disabled={busy || rows.length === 0}
            className="rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-40"
            onClick={() => {
              setBusy(true)
              void commitSceneBlock(rows).finally(() => setBusy(false))
            }}
          >
            Place in scene
          </button>
        )}
      </div>
    </div>
  )
}
