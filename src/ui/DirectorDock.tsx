import { useEffect, useRef, useState } from 'react'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { PROVIDERS } from '../lib/agent/providers'
import { SkillsManager } from './SkillsManager'
import { PlusIcon, ImportIcon, ExpandIcon, ImageIcon } from './icons'
import { directorDockSlot, useViewportInsets, useWindowSize } from './viewportInsets'

function ToolChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-dim">
      {name.replace(/_/g, ' ')}
    </span>
  )
}

const EMPTY_PROMPTS = ['slow orbit around the product, 12s', 'drone dive from above, fast']

const PLACEHOLDER: Record<'build' | 'compose' | 'visualize', string> = {
  build: 'Describe a scene, watch AI build it in 3D',
  compose: 'Ask the Director to block a shot…',
  visualize: 'Describe the shot to generate…',
}

/** Floating Director composer — same bar on Build, Compose, and Visualize. */
export function DirectorDock() {
  const chat = useAgentStore((s) => s.chat)
  const status = useAgentStore((s) => s.status)
  const taskProgress = useAgentStore((s) => s.taskProgress)
  const error = useAgentStore((s) => s.error)
  const failChips = useAgentStore((s) => s.failChips)
  const hasKey = useAgentStore(
    (s) => (s.keys[s.provider] ?? '').trim().length > 0 || s.serverKeys[s.provider],
  )
  const provider = useAgentStore((s) => s.provider)
  const forcedSkill = useAgentStore((s) => s.forcedSkill)
  const liftPhotoName = useAgentStore((s) => s.liftPhotoName)
  const visualizeMedia = useEditorStore((s) => s.visualizeMedia)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const expanded = useEditorStore((s) => s.directorExpanded)
  const showAddDrawer = useEditorStore((s) => s.showAddDrawer)
  const insets = useViewportInsets()
  const win = useWindowSize()
  const dock = directorDockSlot(insets, win.w)
  const [input, setInput] = useState('')
  const [showSkills, setShowSkills] = useState(false)
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const generate = workspaceMode === 'visualize'

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [chat, status, expanded])

  const send = () => {
    const text = input.trim()
    if (!text && !pendingImage) return
    if (!hasKey) {
      useEditorStore.getState().setShowSettings(true)
      return
    }
    const image = pendingImage
    setPendingImage(null)
    setInput('')
    useEditorStore.getState().setDirectorExpanded(true)
    const media = useEditorStore.getState().visualizeMedia
    const body =
      generate && media === 'motion' && text
        ? `${text}\n\nDeliver a camera move I can export as MP4.`
        : text
    void useAgentStore.getState().sendMessage(body, image ?? undefined)
  }

  return (
    <div
      className="absolute z-30 flex min-h-0 flex-col"
      style={{
        right: dock.right,
        bottom: insets.dockBottom,
        width: dock.width,
        ...(expanded ? { top: insets.top } : {}),
      }}
    >
      {expanded && (
        <div className="panel mb-2 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-1 border-b border-line/60 px-3 py-2">
            <span className="text-[11px] font-medium text-ink">
              {generate ? 'Visualize' : 'Director'}
            </span>
            {generate && (
              <button
                type="button"
                onClick={() => useEditorStore.getState().setWorkspaceMode('compose')}
                className="ml-auto rounded-md px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
              >
                Edit Shot
              </button>
            )}
            {!generate && chat.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  useAgentStore.getState().clearChat()
                  useProjectStore.getState().setDirectorChat([])
                }}
                title="New conversation"
                className="ml-auto rounded-md px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
              >
                New
              </button>
            )}
            <button
              type="button"
              title="Collapse chat"
              onClick={() => useEditorStore.getState().setDirectorExpanded(false)}
              className={`rounded-md px-1.5 py-0.5 text-[13px] text-ink-dim hover:text-ink ${generate || chat.length > 0 ? '' : 'ml-auto'}`}
            >
              ×
            </button>
          </div>

          {!hasKey ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center">
              <p className="text-[12px] leading-relaxed text-ink-dim">
                The Director builds camera moves from a prompt. Add your API key to start.
              </p>
              <button
                type="button"
                onClick={() => useEditorStore.getState().setShowSettings(true)}
                className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/85"
              >
                Open Settings
              </button>
            </div>
          ) : (
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-x-hidden overflow-y-auto px-3 py-2">
              {chat.length === 0 && (
                <div className="pt-2 text-[11px] leading-relaxed text-ink-dim">
                  Ask the Director to block a shot.
                  <div className="mt-2 flex flex-col gap-1">
                    {EMPTY_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void useAgentStore.getState().sendMessage(prompt)}
                        className="rounded-md bg-panel-2 px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-3"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chat.map((entry) => (
                <div key={entry.id}>
                  {entry.role === 'user' ? (
                    <div className="rounded-lg bg-panel-2 px-2.5 py-1.5 text-[12px] leading-relaxed text-ink">
                      {entry.attached && (
                        <div className="mb-1 text-[10px] text-ink-dim">Photo: {entry.attached}</div>
                      )}
                      <span className="whitespace-pre-wrap">{entry.text}</span>
                    </div>
                  ) : (
                    <div className="text-[12px] leading-relaxed text-ink">
                      {entry.text ? (
                        <span className="whitespace-pre-wrap">{entry.text}</span>
                      ) : status === 'thinking' ? (
                        <span className="text-ink-dim">Working…</span>
                      ) : null}
                      {entry.tools.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {entry.tools.map((tool, i) => (
                            <ToolChip key={i} name={tool} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {status === 'thinking' && taskProgress && (
                <div className="text-[10px] text-ink-dim">
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  {taskProgress}
                </div>
              )}
              {error && (
                <div className="rounded-md bg-red-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-red-400">
                  {error}
                </div>
              )}
              {failChips.length > 0 && status === 'idle' && (
                <div className="flex flex-wrap gap-1">
                  {failChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => void useAgentStore.getState().sendMessage(chip)}
                      className="rounded-md bg-panel-2 px-2 py-1 text-[10px] text-ink hover:bg-panel-3"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {showSkills && <SkillsManager onClose={() => setShowSkills(false)} />}

          {hasKey && (
            <div className="flex shrink-0 items-center gap-1 border-t border-line/60 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setShowSkills(true)}
                title="Camera skills"
                className="rounded-md px-1.5 py-1 text-[10px] text-ink-dim hover:text-ink"
              >
                Skills
              </button>
              {forcedSkill && (
                <span className="min-w-0 truncate rounded-md bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
                  {forcedSkill}
                </span>
              )}
              <button
                type="button"
                onClick={() => useEditorStore.getState().setShowSettings(true)}
                title="Provider and keys"
                className="ml-auto shrink-0 text-[10px] text-ink-dim hover:text-ink"
              >
                {PROVIDERS[provider].label}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="panel shrink-0 overflow-hidden rounded-3xl p-2.5 focus-within:border-accent">
        <input
          id="director-attach-photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null
            setPendingImage(file)
            e.target.value = ''
          }}
        />
        <div className="flex items-start gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                send()
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder={PLACEHOLDER[workspaceMode]}
            className="min-h-[40px] w-full resize-none bg-transparent text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-dim"
          />
          <button
            type="button"
            title={expanded ? 'Collapse chat' : 'Expand chat'}
            onClick={() => useEditorStore.getState().setDirectorExpanded(!expanded)}
            className="mt-0.5 shrink-0 rounded-md p-1 text-ink-dim hover:bg-panel-2 hover:text-ink"
          >
            <ExpandIcon size={13} />
          </button>
        </div>
        {(pendingImage || liftPhotoName) && (
          <div className="mt-1 truncate px-0.5 text-[10px] text-ink-dim">
            {pendingImage ? `Photo: ${pendingImage.name}` : `Photo in use: ${liftPhotoName} — ask to lift again`}
          </div>
        )}
        {generate && expanded && (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <label className="text-[10px] text-ink-dim">
              Media
              <select
                value={visualizeMedia}
                onChange={(e) =>
                  useEditorStore.getState().setVisualizeMedia(e.target.value as 'still' | 'motion')
                }
                className="mt-0.5 w-full rounded-md bg-panel-3 px-1.5 py-1 text-[11px] text-ink"
              >
                <option value="still">Still</option>
                <option value="motion">Motion (MP4)</option>
              </select>
            </label>
            <label className="text-[10px] text-ink-dim">
              Model
              <select
                value={provider}
                onChange={(e) =>
                  useAgentStore.getState().setProvider(e.target.value as typeof provider)
                }
                className="mt-0.5 w-full rounded-md bg-panel-3 px-1.5 py-1 text-[11px] text-ink"
              >
                {Object.entries(PROVIDERS).map(([id, meta]) => (
                  <option key={id} value={id}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            {workspaceMode === 'build' && (
              <button
                type="button"
                title="Add an object"
                onClick={() => useEditorStore.getState().toggleAddDrawer()}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  showAddDrawer
                    ? 'bg-accent text-white'
                    : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
                }`}
              >
                <PlusIcon size={15} />
              </button>
            )}
            <button
              type="button"
              title="Import a .glb or .gltf"
              onClick={() => useEditorStore.getState().setShowImportModal(true)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              <ImportIcon size={15} />
            </button>
            <label
              htmlFor="director-attach-photo"
              title="Attach a reference photo"
              className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg ${
                pendingImage || liftPhotoName
                  ? 'bg-accent text-white'
                  : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
              }`}
            >
              <ImageIcon size={15} />
            </label>
          </div>
          {status === 'thinking' ? (
            <button
              type="button"
              onClick={() => useAgentStore.getState().stop()}
              title="Stop"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-panel-3 text-[11px] text-ink hover:bg-panel-3/70"
            >
              ■
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!input.trim() && !pendingImage}
              title="Send (Enter)"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-medium ${
                input.trim() || pendingImage
                  ? 'bg-accent text-white hover:bg-accent/85'
                  : 'bg-panel-3 text-ink-dim/50'
              }`}
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** @deprecated use DirectorDock — kept so the old right-rail import still typechecks */
export const AssistantPanel = DirectorDock
