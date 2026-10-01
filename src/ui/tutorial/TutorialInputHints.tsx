import type { TutorialInputHint } from '../../lib/tutorial/steps'

function Keycap({ children }: { children: string }) {
  return <kbd className="inline-flex min-h-6 items-center rounded border border-line bg-panel px-1.5 font-sans text-[10px] font-medium text-ink shadow-[inset_0_-1px_0_rgb(0_0_0/0.3)]">{children}</kbd>
}

function MouseDiagram({ button }: { button: Extract<TutorialInputHint['input'], 'mouse-left' | 'mouse-middle' | 'mouse-wheel'> }) {
  const fill = 'var(--color-accent)'
  return (
    <svg aria-hidden viewBox="0 0 32 42" className="h-9 w-7 shrink-0" fill="none">
      <rect x="4" y="2" width="24" height="38" rx="11" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 2v14" stroke="currentColor" strokeWidth="1.5" />
      {button === 'mouse-left' && <path d="M5 13c0-6 4-10 10-10v13H5v-3Z" fill={fill} fillOpacity=".9" />}
      {button === 'mouse-middle' && <rect x="13" y="6" width="6" height="8" rx="3" fill={fill} />}
      {button === 'mouse-wheel' && <rect x="14" y="6" width="4" height="8" rx="2" fill={fill} />}
      {button === 'mouse-wheel' && <path d="M21 9h6m-3-3 3 3-3 3M11 28H5m3-3-3 3 3 3" stroke={fill} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

function TouchDiagram({ gesture }: { gesture: string }) {
  return (
    <span aria-hidden className="flex h-9 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-panel text-[15px] text-accent">
      {gesture === 'Pinch' ? '↔' : gesture === 'Two-finger drag' ? 'Ⅱ' : '●'}
    </span>
  )
}

function hintInput(hint: TutorialInputHint) {
  if (hint.input === 'keyboard') return <span aria-hidden className="flex h-9 w-7 shrink-0 items-center justify-center rounded border border-line bg-panel text-[11px] text-accent">⌨</span>
  if (hint.input === 'touch') return <TouchDiagram gesture={hint.gesture} />
  return <MouseDiagram button={hint.input} />
}

/** Compact, visual input legend used by practical tutorial actions. */
export function TutorialInputHints({ hints }: { hints: readonly TutorialInputHint[] }) {
  if (hints.length === 0) return null
  return (
    <section aria-label="Input controls" className="mt-2 rounded-lg border border-line bg-panel-2/70 p-2">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-dim">Controls to use</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {hints.map((hint) => (
          <div key={`${hint.label}:${hint.input}:${hint.gesture ?? ''}`} className="flex min-h-11 items-center gap-2 rounded-md bg-panel-2 px-2 py-1.5">
            {hintInput(hint)}
            <div className="min-w-0">
              <p className="text-[11px] font-medium leading-4 text-ink">{hint.label}</p>
              <div className="flex flex-wrap items-center gap-1 text-[10px] leading-4 text-ink-dim">
                {hint.keys?.map((key) => <Keycap key={key}>{key}</Keycap>)}
                {hint.gesture && <span>{hint.gesture}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
