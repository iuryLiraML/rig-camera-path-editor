import { useEffect, useRef, useState } from 'react'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { PROVIDERS } from '../lib/agent/providers'
import { SkillsManager } from './SkillsManager'

function ToolChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-dim">
      {name.replace(/_/g, ' ')}
    </span>
  )
}

const EMPTY_PROMPTS = ['slow orbit around the product, 12s', 'drone dive from above, fast']

export function AssistantPanel() {
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
  const [input, setInput] = useState('')
  const [showSkills, setShowSkills] = useState(false)
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [chat, status])

  const send = () => {
    const text = input.trim()
    if (!text && !pendingImage) return
    const image = pendingImage
    setPendingImage(null)
    setInput('')
    void useAgentStore.getState().sendMessage(text, image ?? undefined)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line/60 px-3 py-2">
        <span className="text-[11px] font-medium text-ink">Director</span>
        {chat.length > 0 && (
          <button
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
      </div>

      {!hasKey ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-[12px] leading-relaxed text-ink-dim">
            The Director builds camera moves from a prompt. Add your API key to start.
          </p>
          <button
            onClick={() => useEditorStore.getState().setShowSettings(true)}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/85"
          >
            Open Settings
          </button>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-x-hidden overflow-y-auto px-3 py-2">
            {chat.length === 0 && (
              <div className="pt-4 text-[11px] leading-relaxed text-ink-dim">
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

          {showSkills && <SkillsManager onClose={() => setShowSkills(false)} />}

          <div className="shrink-0 px-2 pb-2 pt-1">
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
            <div className="overflow-hidden rounded-xl bg-panel-2 p-2">
              {pendingImage && (
                <div className="mb-1 truncate px-0.5 text-[10px] text-ink-dim">
                  Photo: {pendingImage.name}
                </div>
              )}
              {!pendingImage && liftPhotoName && (
                <div className="mb-1 truncate px-0.5 text-[10px] text-ink-dim">
                  Photo in use: {liftPhotoName} — ask to lift again
                </div>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                rows={2}
                placeholder="Ask the Director…"
                className="max-h-28 w-full resize-none overflow-x-hidden bg-transparent text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-dim"
              />
              <div ref={composerBarRef} className="mt-1 flex min-w-0 items-center gap-1">
                <label
                  htmlFor="director-attach-photo"
                  title="Attach a reference photo"
                  className={`cursor-pointer rounded-md px-1.5 py-1 text-[10px] ${
                    pendingImage || liftPhotoName ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink'
                  }`}
                >
                  Attach
                </label>
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
                {status === 'thinking' ? (
                  <button
                    onClick={() => useAgentStore.getState().stop()}
                    title="Stop"
                    className="shrink-0 rounded-md bg-panel-3 px-2 py-1 text-[11px] text-ink hover:bg-panel-3/70"
                  >
                    ■
                  </button>
                ) : (
                  <button
                    onClick={send}
                    disabled={!input.trim() && !pendingImage}
                    title="Send (Enter)"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-medium ${
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
        </>
      )}
    </div>
  )
}
