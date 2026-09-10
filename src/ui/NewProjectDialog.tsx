import { useEffect, useRef, useState } from 'react'
import { generateProductionBreakdown, type ProductionBreakdown } from '../lib/agent/productionBreakdown'
import { createGuidedProject, createProject } from '../lib/projects'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectCreationStore } from '../state/useProjectCreationStore'

const field = 'mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const button = 'rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm text-ink hover:bg-panel-3 disabled:opacity-40'

export function NewProjectDialog() {
  const open = useProjectCreationStore((state) => state.open)
  return open ? <ProjectIntake /> : null
}

function ProjectIntake() {
  const { close, folderId } = useProjectCreationStore()
  const [mode, setMode] = useState<'choose' | 'ai'>('choose')
  const [source, setSource] = useState('')
  const [guidelines, setGuidelines] = useState('')
  const [sceneCount, setSceneCount] = useState('')
  const [draft, setDraft] = useState<ProductionBreakdown | null>(null)
  const [busy, setBusy] = useState<'analyzing' | 'creating' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const firstControl = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstControl.current?.focus()
    return () => controller.current?.abort()
  }, [])

  const dismiss = () => {
    if (busy === 'creating') return
    controller.current?.abort()
    close()
  }
  const create = async (plan: ProductionBreakdown | null) => {
    if (pending.current) return
    pending.current = true
    setBusy('creating')
    setError(null)
    try {
      if (plan) await createGuidedProject(plan, source, folderId)
      else await createProject('New project', folderId)
      const editor = useEditorStore.getState()
      editor.setAppView('editor')
      editor.setWorkspaceMode('build')
      editor.setShowProduction(Boolean(plan))
      close()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The project could not be created.')
    } finally {
      pending.current = false
      setBusy(null)
    }
  }
  const analyze = async () => {
    if (pending.current) return
    pending.current = true
    setBusy('analyzing')
    setError(null)
    const abort = new AbortController()
    controller.current = abort
    try {
      const agent = useAgentStore.getState()
      const proposal = await generateProductionBreakdown({ source, guidelines, sceneCount: sceneCount ? Number(sceneCount) : undefined, signal: abort.signal,
        provider: { kind: agent.provider, model: agent.models[agent.provider], vision: false } })
      if (!abort.signal.aborted) setDraft(proposal)
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'Analysis failed. Please try again.')
    } finally {
      pending.current = false
      setBusy(null)
    }
  }

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-5" onKeyDown={(event) => {
    event.stopPropagation()
    if (event.key === 'Escape') dismiss()
    if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'))
      const target = event.shiftKey ? controls.at(-1) : controls[0]
      if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) { event.preventDefault(); target?.focus() }
    }
  }}>
    <section role="dialog" aria-modal="true" aria-labelledby="new-project-title" className="panel flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <div><h2 id="new-project-title" className="text-base font-semibold text-ink">New project</h2><p className="mt-1 text-xs text-ink-dim">{draft ? 'Review your project before creating it.' : 'Start with an empty scene or plan your production with AI.'}</p></div>
        <button ref={firstControl} onClick={dismiss} disabled={busy === 'creating'} aria-label="Close new project" className={button}>Close</button>
      </header>
      <div className="min-h-0 overflow-y-auto p-6">
        {mode === 'choose' ? <div className="grid gap-4 sm:grid-cols-2">
          <button onClick={() => void create(null)} disabled={Boolean(busy)} className="rounded-xl border border-line bg-panel-2 p-6 text-left hover:border-accent"><span className="block text-base font-medium text-ink">Blank scene</span><span className="mt-2 block text-sm leading-6 text-ink-dim">Open Build with an empty scene. Add objects and draw camera paths manually.</span></button>
          <button onClick={() => setMode('ai')} disabled={Boolean(busy)} className="rounded-xl border border-line bg-panel-2 p-6 text-left hover:border-accent"><span className="block text-base font-medium text-ink">Start with AI</span><span className="mt-2 block text-sm leading-6 text-ink-dim">Paste a script or describe your project. Review scenes, assets and prompts before generating anything.</span></button>
        </div> : !draft ? <div className="space-y-4">
          <label className="block text-sm text-ink">Script or project description<textarea className={field} rows={9} maxLength={100000} value={source} onChange={(event) => setSource(event.target.value)} disabled={Boolean(busy)} placeholder="A quiet cafe at dawn. Ana meets a friend by the window…" /></label>
          <label className="block text-sm text-ink">Project guidelines <span className="text-ink-dim">(optional)</span><textarea className={field} rows={3} value={guidelines} onChange={(event) => setGuidelines(event.target.value)} disabled={Boolean(busy)} placeholder="Visual style, character continuity, constraints…" /></label>
          <label className="block text-sm text-ink">Number of scenes <span className="text-ink-dim">(optional)</span><input aria-label="Number of scenes" type="number" min={1} max={100} step={1} className={field} value={sceneCount} onChange={(event) => setSceneCount(event.target.value)} disabled={Boolean(busy)} placeholder="Let AI suggest" /></label>
          <p className="text-xs text-ink-dim">The AI proposes a plan. You approve assets and references before paid image or 3D generation.</p>
          <div className="flex justify-between gap-3"><button className={button} disabled={Boolean(busy)} onClick={() => setMode('choose')}>Back</button><button className={`${button} border-accent`} disabled={!source.trim() || Boolean(busy) || Boolean(sceneCount && (!Number.isInteger(Number(sceneCount)) || Number(sceneCount) < 1 || Number(sceneCount) > 100))} onClick={() => void analyze()}>{busy === 'analyzing' ? 'Analyzing your project…' : 'Create production plan'}</button></div>
        </div> : <div className="space-y-5">
          <label className="block text-sm text-ink">Project name<input className={field} value={draft.name} disabled={Boolean(busy)} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <div><h3 className="text-sm font-medium text-ink">Scenes · {draft.proposal.scenes.length}</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{draft.proposal.scenes.map((scene, index) => <label key={scene.sourceKey} className="text-xs text-ink-dim">Scene {index + 1}<input className={field} disabled={Boolean(busy)} value={scene.name} onChange={(event) => setDraft({ ...draft, proposal: { ...draft.proposal, scenes: draft.proposal.scenes.map((entry) => entry.sourceKey === scene.sourceKey ? { ...entry, name: event.target.value } : entry) } })} /></label>)}</div></div>
          <label className="block text-sm text-ink">Project guidelines<textarea className={field} rows={3} disabled={Boolean(busy)} value={draft.guidelines} onChange={(event) => setDraft({ ...draft, guidelines: event.target.value })} /></label>
          <div><h3 className="text-sm font-medium text-ink">Production list · {draft.proposal.items.length} reusable assets</h3><p className="mt-1 text-xs text-ink-dim">Requirements and prompts remain pending your approval in the next step.</p><ul className="mt-3 divide-y divide-line">{draft.proposal.items.map((item) => <li key={item.sourceKey} className="flex justify-between gap-3 py-2 text-sm text-ink"><span>{item.name} <span className="text-xs text-ink-dim">· {item.kind}{item.variantLabel ? ` · ${item.variantLabel}` : ''}</span></span><span className="text-xs text-ink-dim">{item.provenance === 'suggested' ? 'Suggested · ' : ''}{item.quantity} instance{item.quantity === 1 ? '' : 's'}</span></li>)}</ul></div>
          <div className="flex justify-between gap-3"><button className={button} disabled={Boolean(busy)} onClick={() => setDraft(null)}>Edit brief</button><button className={`${button} border-accent`} disabled={Boolean(busy) || !draft.name.trim() || draft.proposal.scenes.some((scene) => !scene.name.trim())} onClick={() => void create(draft)}>{busy === 'creating' ? 'Creating project…' : 'Create project and review assets'}</button></div>
        </div>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/30 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </section>
  </div>
}
