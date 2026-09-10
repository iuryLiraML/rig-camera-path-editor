import { useEffect, useRef, useState } from 'react'
import { goHome } from '../lib/projects'
import { useSaveStatusStore } from '../lib/saveStatus'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { HomeIcon, ListIcon } from './icons'
import { AccountMenu } from './AccountMenu'
import { SceneSwitcher } from './SceneSwitcher'
import { syncProjectToCloud } from '../lib/cloud/sync'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { TOP_ROW_HEIGHT } from './viewportInsets'

const SAVE_CHIP: Record<'saved' | 'saving' | 'dirty', { label: string; className: string }> = {
  saved: { label: 'Saved', className: 'text-ink-dim' },
  saving: { label: 'Saving…', className: 'text-ink-dim' },
  dirty: { label: 'Not saved', className: 'text-amber-400' },
}

export function ProjectChip({ variant = 'pill' }: { variant?: 'pill' | 'header' }) {
  const name = useProjectStore((s) => s.name)
  const projectId = useProjectStore((s) => s.projectId)
  const showOutliner = useEditorStore((s) => s.showOutliner)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const saveStatus = useSaveStatusStore((s) => s.status)
  const cloud = useSaveStatusStore((s) => s.cloud[projectId])
  const signedIn = useCloudAuthStore((s) => s.status === 'signed-in')
  const canToggleOutliner = workspaceMode !== 'visualize'
  const draft = !projectId && saveStatus === 'saved'
  const cloudChip = signedIn && saveStatus === 'saved' && cloud ? { label: cloud === 'saved' ? 'Synced' : cloud === 'error' ? 'Saved locally · Sync failed' : 'Saved locally · Syncing…', className: 'text-ink-dim' } : null
  const chip = cloudChip ?? (draft ? { label: 'Draft', className: 'text-ink-dim' } : SAVE_CHIP[saveStatus])
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(name)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const editingNameRef = useRef(false)
  const isHeader = variant === 'header'

  useEffect(() => {
    if (!editingName) setNameDraft(name)
  }, [name, editingName])

  useEffect(() => {
    if (editingName) nameInputRef.current?.select()
  }, [editingName])

  const startRename = () => {
    editingNameRef.current = true
    setNameDraft(name)
    setEditingName(true)
  }

  const commitRename = () => {
    if (!editingNameRef.current) return
    editingNameRef.current = false
    setEditingName(false)
    const next = nameDraft.trim() || 'Untitled'
    if (next !== name) useProjectStore.getState().setName(next)
  }

  const cancelRename = () => {
    editingNameRef.current = false
    setNameDraft(name)
    setEditingName(false)
  }

  const nav = (
    <div className="flex shrink-0 items-center gap-1">
      {canToggleOutliner && (
        <button
          type="button"
          title="Outliner"
          onClick={() => useEditorStore.getState().toggleOutliner()}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
            showOutliner ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
          }`}
        >
          <ListIcon size={14} />
        </button>
      )}
      <button
        type="button"
        title="Back to Home"
        onClick={() => void goHome()}
        className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-ink-dim hover:bg-panel-2 hover:text-ink"
      >
        <HomeIcon size={13} />
        Home
      </button>
      {projectId && (
        <button
          type="button"
          title="Production list"
          onClick={() => useEditorStore.getState().setShowProduction(true)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-dim hover:bg-panel-2 hover:text-ink"
        >
          <ListIcon size={14} />
        </button>
      )}
    </div>
  )

  const nameClass = isHeader
    ? 'min-w-0 truncate whitespace-nowrap'
    : 'max-w-[8rem] shrink-0 truncate'

  const identity = (
    <div className={`flex min-w-0 items-center ${isHeader ? 'flex-1 overflow-hidden' : 'gap-1.5'}`}>
      {editingName ? (
        <input
          ref={nameInputRef}
          value={nameDraft}
          aria-label="Project name"
          title="Project name"
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') cancelRename()
          }}
          className={`rounded-md border border-line bg-panel-2 px-1.5 py-0.5 text-[11px] font-medium text-ink outline-none ${nameClass}`}
        />
      ) : (
        <button
          type="button"
          title="Project name"
          onDoubleClick={(e) => {
            e.preventDefault()
            startRename()
          }}
          className={`rounded-md px-1 py-0.5 text-left text-[11px] font-medium text-ink hover:bg-panel-2 ${nameClass}`}
        >
          {name || 'Untitled'}
        </button>
      )}
      {!isHeader && <SceneSwitcher />}
    </div>
  )

  const meta = (
    <div className="flex shrink-0 items-center gap-1.5">
      <span
        data-save-status={saveStatus}
        className={`shrink-0 text-[10px] ${chip.className}`}
        title={cloudChip ? cloudChip.label : draft ? 'Temporary session — changes will save this project locally' : saveStatus === 'saved' ? 'Saved in this browser' : chip.label}
      >
        {chip.label}
      </span>
      {signedIn && cloud === 'error' && <button type="button" className="text-[10px] text-ink underline" onClick={() => void syncProjectToCloud(projectId).catch(() => {})}>Retry sync</button>}
      <AccountMenu />
    </div>
  )

  if (isHeader) {
    return (
      <div
        data-project-chip
        className="flex w-full shrink-0 items-center gap-2 border-b border-line/60 px-2"
        style={{ height: TOP_ROW_HEIGHT }}
      >
        {nav}
        {identity}
        {meta}
      </div>
    )
  }

  return (
    <div
      data-project-chip
      className="panel z-50 box-border flex shrink-0 items-center gap-3 overflow-visible px-2 py-1"
      style={{ width: 'max-content', height: TOP_ROW_HEIGHT }}
    >
      {nav}
      {identity}
      {meta}
    </div>
  )
}
