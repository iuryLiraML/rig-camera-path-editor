import { useEffect, useState } from 'react'
import {
  addAssetTag,
  assignAssetToCollection,
  createLibraryCollection,
  createProjectFromAsset,
  deleteLibraryAsset,
  deleteLibraryCollection,
  insertLibraryAssetIntoScene,
  removeAssetTag,
  renameLibraryCollection,
  useLibraryStore,
  type LibraryAsset,
  type LibraryCollection,
  type LibraryFilters,
} from '../lib/library'
import { useProjectStore } from '../state/useProjectStore'
import { useLibraryAssetPicker } from './LibraryAssetPicker'
import { goPlan } from '../lib/planEditor'
import { WorkspaceChrome, WorkspacePage } from './WorkspaceChrome'
import { EditIcon, ImageIcon, PlusIcon, TrashIcon } from './icons'

function TagChip({ tag, active, onClick }: { tag: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? 'border-accent/60 bg-accent/15 text-ink'
          : 'border-line bg-panel-2 text-ink-dim hover:border-accent/40 hover:text-ink'
      }`}
    >
      {tag}
    </button>
  )
}

function AssetStill({ asset }: { asset: LibraryAsset }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!asset.thumbnail) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(asset.thumbnail)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [asset.thumbnail])

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-panel-2">
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-panel-2 to-panel-3">
          <ImageIcon size={30} className="text-ink-dim/40" />
        </div>
      )}
    </div>
  )
}

function CollectionNameInput({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string
  label: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <input
      autoFocus
      value={value}
      aria-label={label}
      onChange={(event) => setValue(event.target.value)}
      onBlur={onCancel}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && value.trim()) onCommit(value)
        if (event.key === 'Escape') onCancel()
      }}
      className="w-full rounded-md border border-line bg-panel-2 px-2 py-1 text-[13px] text-ink outline-none focus:border-accent/60"
    />
  )
}

function CollectionRow({ collection, count }: { collection: LibraryCollection; count: number }) {
  const active = useLibraryStore((state) => state.filters.collectionId === collection.id)
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)

  if (renaming) {
    return (
      <li className="px-1.5 py-0.5">
        <CollectionNameInput
          initial={collection.name}
          label="Collection name"
          onCommit={(name) => {
            setRenaming(false)
            void renameLibraryCollection(collection.id, name)
          }}
          onCancel={() => setRenaming(false)}
        />
      </li>
    )
  }

  return (
    <li className="group/row relative">
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={() => useLibraryStore.getState().setFilters({ collectionId: collection.id })}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
          active ? 'bg-panel-3 font-medium text-ink' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
        }`}
      >
        <span className="min-w-0 truncate">{collection.name}</span>
        <span className="shrink-0 text-[11px] text-ink-dim/70 group-hover/row:opacity-0 group-focus-within/row:opacity-0">{count}</span>
      </button>
      <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 rounded-md bg-panel-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
        <button
          type="button"
          aria-label={`Rename collection ${collection.name}`}
          title="Rename collection"
          onClick={() => setRenaming(true)}
          className="rounded p-0.5 text-ink-dim hover:text-ink"
        >
          <EditIcon size={12} />
        </button>
        <button
          type="button"
          aria-label={`Delete collection ${collection.name}`}
          onClick={() => {
            if (!confirming) {
              setConfirming(true)
              return
            }
            void deleteLibraryCollection(collection.id)
          }}
          onBlur={() => setConfirming(false)}
          title={confirming ? 'Click again — assets return to Unfiled' : 'Delete collection'}
          className={`rounded p-0.5 ${confirming ? 'text-red-400' : 'text-ink-dim hover:text-red-300'}`}
        >
          <TrashIcon size={12} />
        </button>
      </span>
      {confirming ? (
        <span className="pointer-events-none absolute right-0 top-full z-10 mt-1 w-44 rounded-lg border border-line bg-panel px-2 py-1 text-[11px] text-ink-dim shadow-lg">
          Click again — assets return to Unfiled
        </span>
      ) : null}
    </li>
  )
}

function CollectionNav({ assets, collections }: { assets: LibraryAsset[]; collections: LibraryCollection[] }) {
  const filters = useLibraryStore((state) => state.filters)
  const [creating, setCreating] = useState(false)
  const unfiled = assets.filter((asset) => asset.collectionId === null).length

  const fixedRows: { id: 'all' | 'unfiled'; label: string; count: number }[] = [
    { id: 'all', label: 'All assets', count: assets.length },
    { id: 'unfiled', label: 'Unfiled', count: unfiled },
  ]

  return (
    <nav aria-label="Collections" className="flex flex-col gap-0.5">
      {fixedRows.map((row) => (
        <button
          key={row.id}
          type="button"
          aria-current={filters.collectionId === row.id ? 'true' : undefined}
          onClick={() => useLibraryStore.getState().setFilters({ collectionId: row.id })}
          className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
            filters.collectionId === row.id
              ? 'bg-panel-3 font-medium text-ink'
              : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
          }`}
        >
          <span>{row.label}</span>
          <span className="text-[11px] text-ink-dim/70">{row.count}</span>
        </button>
      ))}
      {collections.length > 0 && <div className="mx-2.5 my-2 h-px bg-line/60" />}
      <ul className="flex flex-col gap-0.5">
        {collections.map((collection) => (
          <CollectionRow
            key={collection.id}
            collection={collection}
            count={assets.filter((asset) => asset.collectionId === collection.id).length}
          />
        ))}
      </ul>
      {creating ? (
        <div className="mt-1 px-1.5">
          <CollectionNameInput
            initial=""
            label="Collection name"
            onCommit={(name) => {
              setCreating(false)
              void createLibraryCollection(name)
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink"
        >
          <PlusIcon size={12} />
          New collection
        </button>
      )}
    </nav>
  )
}

export function LibraryWorkspace() {
  const assets = useLibraryStore((state) => state.assets)
  const collections = useLibraryStore((state) => state.collections)
  const selectedId = useLibraryStore((state) => state.selectedId)
  const filters = useLibraryStore((state) => state.filters)
  const projectOpen = useProjectStore((state) => Boolean(state.projectId))
  const activeCollectionId = filters.collectionId === 'all' || filters.collectionId === 'unfiled' ? null : filters.collectionId
  const picker = useLibraryAssetPicker('Import asset file', activeCollectionId)
  const selected = assets.find((item) => item.id === selectedId) ?? null
  const [tagDraft, setTagDraft] = useState('')

  const allTags = [...new Set(assets.flatMap((asset) => asset.tags))].sort()

  const visible = assets.filter((asset) => {
    if (filters.collectionId === 'unfiled' && asset.collectionId !== null) return false
    if (filters.collectionId !== 'all' && filters.collectionId !== 'unfiled' && asset.collectionId !== filters.collectionId) return false
    if (filters.kind !== 'all' && asset.kind !== filters.kind) return false
    if (filters.tag && !asset.tags.includes(filters.tag)) return false
    const query = filters.query.trim().toLowerCase()
    if (query && !asset.name.toLowerCase().includes(query) && !asset.tags.some((tag) => tag.includes(query))) return false
    return true
  })

  const setFilters = (patch: Partial<LibraryFilters>) => useLibraryStore.getState().setFilters(patch)

  function emptyCopy(): { title: string; body: string; showImport: boolean } {
    if (filters.tag) {
      return { title: `Nothing tagged "${filters.tag}"`, body: 'Clear the filter or tag an asset to see it here.', showImport: false }
    }
    if (filters.query.trim()) {
      return { title: `No matches for "${filters.query.trim()}"`, body: 'Search matches asset names and tags.', showImport: false }
    }
    if (filters.kind === 'model') {
      return { title: 'No models yet', body: 'Import a .glb, .gltf or .obj mesh to add a Model.', showImport: true }
    }
    if (filters.kind === 'plan') {
      return { title: 'No plans yet', body: 'Draw a floor plan to add a Plan.', showImport: false }
    }
    if (filters.kind === 'location') {
      return { title: 'No locations yet', body: 'Import a .ply or .splat splat to add a Location.', showImport: true }
    }
    if (filters.collectionId !== 'all') {
      return { title: 'Nothing here yet', body: 'Import assets while viewing this collection to file them here.', showImport: true }
    }
    return {
      title: 'No assets yet',
      body: 'Import assets to add a Location (.ply/.splat) or a Model (.glb/.obj) to your Account shelf.',
      showImport: true,
    }
  }

  const kindChips: { id: LibraryFilters['kind']; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'location', label: 'Locations' },
    { id: 'model', label: 'Models' },
    { id: 'plan', label: 'Plans' },
  ]

  const empty = emptyCopy()

  return (
    <WorkspacePage>
      <WorkspaceChrome
        title="Library"
        description="Account shelf for imported assets. Create project links the Location; it does not copy the file."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void goPlan(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <PlusIcon size={14} />
              New floor plan
            </button>
            <button
              type="button"
              onClick={() => picker.open()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <PlusIcon size={14} />
              Import assets
            </button>
          </div>
        }
      />
      {picker.input}
      <div className="mt-10 flex gap-8">
        <aside className="hidden w-52 shrink-0 md:block">
          <CollectionNav assets={assets} collections={collections} />
        </aside>
        <div className="min-w-0 flex-1">
          <div className="mb-5 md:hidden">
            <select
              aria-label="Collection"
              value={filters.collectionId}
              onChange={(event) => setFilters({ collectionId: event.target.value })}
              className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink"
            >
              <option value="all">All assets ({assets.length})</option>
              <option value="unfiled">Unfiled</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-2">
            <input
              type="search"
              aria-label="Search assets"
              placeholder="Search assets"
              value={filters.query}
              onChange={(event) => setFilters({ query: event.target.value })}
              className="w-48 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-dim/60 focus:border-accent/60"
            />
            <div className="flex rounded-lg border border-line bg-panel-2 p-0.5" role="group" aria-label="Filter by kind">
              {kindChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={filters.kind === chip.id}
                  onClick={() => setFilters({ kind: chip.id })}
                  className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                    filters.kind === chip.id ? 'bg-panel-3 font-medium text-ink' : 'text-ink-dim hover:text-ink'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            {allTags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                active={filters.tag === tag}
                onClick={() => setFilters({ tag: filters.tag === tag ? null : tag })}
              />
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-panel-2 text-ink-dim/50">
                <ImageIcon size={32} />
              </div>
              <p className="mt-5 text-[15px] font-medium text-ink">{empty.title}</p>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-ink-dim">{empty.body}</p>
              {empty.showImport ? (
                <button
                  type="button"
                  onClick={() => picker.open()}
                  className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
                >
                  <PlusIcon size={14} />
                  Import assets
                </button>
              ) : filters.kind === 'plan' ? (
                <button
                  type="button"
                  onClick={() => void goPlan(null)}
                  className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
                >
                  <PlusIcon size={14} />
                  New floor plan
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setFilters({ kind: 'all', tag: null, query: '' })}
                  className="mt-6 rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm text-ink transition-colors hover:bg-panel-3"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((asset) => {
                const current = asset.id === selectedId
                return (
                  <li
                    key={asset.id}
                    className={`group overflow-hidden rounded-xl border bg-panel transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgb(0_0_0/0.25)] ${
                      current
                        ? 'border-accent/60 ring-1 ring-accent/40'
                        : 'border-line hover:border-accent/40'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={current}
                      onClick={() => useLibraryStore.getState().setSelectedId(asset.id)}
                      onDoubleClick={() => { if (asset.kind === 'plan') void goPlan(asset.id) }}
                      className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <AssetStill asset={asset} />
                      <div className="px-4 pt-3.5">
                        <span className="block truncate text-sm font-medium text-ink">{asset.name}</span>
                        <span className="mt-1 block text-[11px] font-medium uppercase tracking-wider text-ink-dim">
                          {asset.format}
                        </span>
                      </div>
                    </button>
                    {asset.kind === 'plan' && <button type="button" onClick={() => void goPlan(asset.id)} className="mx-4 mt-2 rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel-2">Edit plan</button>}
                    <div className="flex min-h-[34px] flex-wrap items-start gap-1.5 px-4 pb-3.5 pt-2.5">
                      {asset.tags.map((tag) => (
                        <TagChip
                          key={tag}
                          tag={tag}
                          active={filters.tag === tag}
                          onClick={() => setFilters({ tag: filters.tag === tag ? null : tag })}
                        />
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {selected ? (
            <div className="sticky bottom-6 mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-5 py-4 shadow-[0_8px_24px_rgb(0_0_0/0.35)]">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="text-sm text-ink-dim">
                  Selected <span className="font-medium text-ink">{selected.name}</span>
                </p>
                {selected.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-line/70 bg-panel-2 px-2 py-0.5 text-[11px] text-ink-dim"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() => void removeAssetTag(selected.id, tag)}
                      className="text-ink-dim/60 hover:text-red-300"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  value={tagDraft}
                  aria-label="Add tag"
                  placeholder="Add tag"
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && tagDraft.trim()) {
                      void addAssetTag(selected.id, tagDraft)
                      setTagDraft('')
                    }
                  }}
                  className="w-20 rounded-md border border-line bg-panel-2 px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-dim/60 focus:border-accent/60"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Move to collection"
                  value={selected.collectionId ?? ''}
                  onChange={(event) =>
                    void assignAssetToCollection(selected.id, event.target.value || null)
                  }
                  className="rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-sm text-ink-dim hover:text-ink"
                >
                  <option value="">Unfiled</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void deleteLibraryAsset(selected.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-3.5 py-2 text-sm text-ink-dim transition-colors hover:border-red-500/40 hover:text-red-300"
                >
                  <TrashIcon size={13} />
                  Delete
                </button>
                {selected.kind === 'plan' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void goPlan(selected.id)}
                      className="rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void insertLibraryAssetIntoScene(selected.id)}
                      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {projectOpen ? 'Insert into scene' : 'New project with this plan'}
                    </button>
                  </>
                ) : selected.kind === 'model' ? (
                  <button
                    type="button"
                    onClick={() => void insertLibraryAssetIntoScene(selected.id)}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {projectOpen ? 'Insert into scene' : 'New project with this asset'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void createProjectFromAsset(selected.id)}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Create project
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </WorkspacePage>
  )
}
