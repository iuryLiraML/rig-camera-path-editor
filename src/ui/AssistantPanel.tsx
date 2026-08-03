import { useEffect, useRef, useState } from 'react'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { AGENT_SKILLS } from '../lib/agent/skills'
import { SkillsManager } from './SkillsManager'

function ToolChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-dim">
      <span className="text-accent">⚙</span>
      {name.replace(/_/g, ' ')}
    </span>
  )
}

export function AssistantPanel() {
  const chat = useAgentStore((s) => s.chat)
  const status = useAgentStore((s) => s.status)
  const taskProgress = useAgentStore((s) => s.taskProgress)
  const error = useAgentStore((s) => s.error)
  const hasKey = useAgentStore((s) => (s.keys[s.provider] ?? '').trim().length > 0)
  const forcedSkill = useAgentStore((s) => s.forcedSkill)
  const customSkills = useProjectStore((s) => s.skills)
  const [input, setInput] = useState('')
  const [showSkills, setShowSkills] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [chat, status])

  const send = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    void useAgentStore.getState().sendMessage(text)
  }

  if (!hasKey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-[12px] leading-relaxed text-ink-dim">
          The assistant builds camera moves and object animation from a prompt — it needs
          your Anthropic API key to run.
        </p>
        <button
          onClick={() => useEditorStore.getState().setShowSettings(true)}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/85"
        >
          Open Settings
        </button>
        <button
          onClick={() => setShowSkills(true)}
          className="text-[11px] text-ink-dim hover:text-ink"
        >
          Manage camera skills
        </button>
        {showSkills && <SkillsManager onClose={() => setShowSkills(false)} />}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {chat.length === 0 && (
          <div className="pt-6 text-center text-[11px] leading-relaxed text-ink-dim">
            Describe the shot you want.
            <br />
            <span className="text-ink">"slow orbit around the product, 12s"</span>
            <br />
            <span className="text-ink">"drone dive from above, fast"</span>
          </div>
        )}
        {chat.map((entry) => (
          <div key={entry.id} className={entry.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={
                entry.role === 'user'
                  ? 'max-w-[85%] rounded-lg rounded-br-sm bg-accent px-2.5 py-1.5 text-[12px] leading-relaxed text-white'
                  : 'text-[12px] leading-relaxed text-ink'
              }
            >
              {entry.text ? (
                <span className="whitespace-pre-wrap">{entry.text}</span>
              ) : entry.role === 'assistant' && status === 'thinking' ? (
                <span className="text-ink-dim">Thinking…</span>
              ) : null}
              {entry.tools.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {entry.tools.map((tool, i) => (
                    <ToolChip key={i} name={tool} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {error && (
          <div className="rounded-md bg-red-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-red-400">
            {error}
          </div>
        )}
      </div>

      {status === 'thinking' && taskProgress && (
        <div className="border-t border-line/60 px-3 py-1.5 text-[10px] text-ink-dim">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          {taskProgress}
        </div>
      )}

      {/* skill chips */}
      <div className="flex flex-wrap items-center gap-1 border-t border-line/60 px-3 pt-2">
        {[...AGENT_SKILLS.map((s) => s.name), ...customSkills.filter((s) => s.name.trim()).map((s) => s.name)].map(
          (name) => (
            <button
              key={name}
              onClick={() =>
                useAgentStore.getState().setForcedSkill(forcedSkill === name ? null : name)
              }
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                forcedSkill === name ? 'bg-accent text-white' : 'bg-panel-2 text-ink-dim hover:text-ink'
              }`}
            >
              {name}
            </button>
          ),
        )}
        <button
          onClick={() => setShowSkills(true)}
          title="Create and edit camera skills"
          className="rounded-full px-2 py-0.5 text-[10px] text-accent hover:bg-panel-2"
        >
          + skill
        </button>
        {chat.length > 0 && (
          <button
            onClick={() => useAgentStore.getState().clearChat()}
            className="ml-auto rounded-full px-2 py-0.5 text-[10px] text-ink-dim hover:text-ink"
            title="Clear conversation"
          >
            clear
          </button>
        )}
      </div>

      {showSkills && <SkillsManager onClose={() => setShowSkills(false)} />}

      {/* input */}
      <div className="p-3 pt-2">
        <div className="flex items-end gap-1.5 rounded-lg bg-panel-2 p-1.5">
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
            placeholder="Describe a camera move…"
            className="max-h-32 w-full resize-none bg-transparent text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-dim"
          />
          {status === 'thinking' ? (
            <button
              onClick={() => useAgentStore.getState().stop()}
              title="Stop"
              className="shrink-0 rounded-md bg-panel-3 px-2.5 py-1.5 text-[11px] text-ink hover:bg-panel-3/70"
            >
              ■
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              title="Send (Enter)"
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                input.trim() ? 'bg-accent text-white hover:bg-accent/85' : 'bg-panel-3 text-ink-dim/50'
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
