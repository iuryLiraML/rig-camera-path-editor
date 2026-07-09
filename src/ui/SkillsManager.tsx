import { useState } from 'react'
import { useProjectStore, type CustomSkill } from '../state/useProjectStore'
import { AGENT_SKILLS } from '../lib/agent/skills'
import { makeSceneId } from '../state/useSceneStore'

const EXAMPLE_BODY = `# My move

Feel: describe the mood in one line.

Recipe (world units: subjects ~2 units tall, floor y=0):
- Path: where the anchors go, how many, rounding, height.
- Timing: duration, smoothness, any hold at the end.
- Framing: look-at target vs motion, FOV, roll.

Avoid: common mistakes for this style.`

/** Create / edit / remove the project's custom camera skills. */
export function SkillsManager({ onClose }: { onClose: () => void }) {
  const skills = useProjectStore((s) => s.skills)
  const [editing, setEditing] = useState<CustomSkill | null>(null)

  const startNew = () =>
    setEditing({ id: makeSceneId('skill'), name: '', description: '', body: EXAMPLE_BODY })

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="panel flex h-[80vh] max-h-[640px] w-[720px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line/60 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Camera skills</h2>
          <button onClick={onClose} className="text-ink-dim hover:text-ink" title="Close">
            ×
          </button>
        </div>

        {editing ? (
          <SkillEditor
            skill={editing}
            onDone={() => setEditing(null)}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-3 text-[11px] leading-relaxed text-ink-dim">
              Skills are camera-move recipes the assistant loads on demand. Write your own
              (they live in this project) alongside the built-in ones.
            </p>

            <button
              onClick={startNew}
              className="mb-4 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/85"
            >
              + New skill
            </button>

            {skills.length > 0 && (
              <>
                <div className="mb-1.5 text-[10px] font-medium text-ink-dim">Your skills</div>
                <div className="mb-4 space-y-1.5">
                  {skills.map((skill) => (
                    <div
                      key={skill.id}
                      className="flex items-center gap-2 rounded-md bg-panel-2 px-2.5 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-ink">
                          {skill.name || '(unnamed)'}
                        </div>
                        <div className="truncate text-[10px] text-ink-dim">
                          {skill.description || 'no description'}
                        </div>
                      </div>
                      <button
                        onClick={() => setEditing(skill)}
                        className="rounded px-2 py-0.5 text-[11px] text-ink hover:bg-panel-3"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => useProjectStore.getState().removeSkill(skill.id)}
                        className="rounded px-2 py-0.5 text-[11px] text-red-400 hover:bg-panel-3"
                        title="Delete skill"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="mb-1.5 text-[10px] font-medium text-ink-dim">Built-in</div>
            <div className="space-y-1">
              {AGENT_SKILLS.map((skill) => (
                <div key={skill.name} className="rounded-md px-2.5 py-1.5">
                  <div className="text-[12px] text-ink">{skill.name}</div>
                  <div className="text-[10px] text-ink-dim">{skill.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SkillEditor({ skill, onDone }: { skill: CustomSkill; onDone: () => void }) {
  const [name, setName] = useState(skill.name)
  const [description, setDescription] = useState(skill.description)
  const [body, setBody] = useState(skill.body)

  const save = () => {
    useProjectStore.getState().upsertSkill({ ...skill, name: name.trim(), description: description.trim(), body })
    onDone()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Skill name (e.g. crash-zoom)"
          className="w-44 rounded-md bg-panel-2 px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-dim"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One-line description — when to use it"
          className="min-w-0 flex-1 rounded-md bg-panel-2 px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-dim"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Recipe the assistant will follow…"
        className="min-h-0 flex-1 resize-none rounded-md bg-panel-2 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink outline-none placeholder:text-ink-dim"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onDone}
          className="rounded-md bg-panel-2 px-3 py-1.5 text-[12px] text-ink hover:bg-panel-3"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!name.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/85 disabled:cursor-not-allowed disabled:bg-panel-3 disabled:text-ink-dim/60"
        >
          Save skill
        </button>
      </div>
    </div>
  )
}
