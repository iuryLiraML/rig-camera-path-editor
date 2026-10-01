import { useEffect, useRef } from 'react'

function SampleFrames() {
  return (
    <svg viewBox="0 0 900 270" role="img" aria-label="Three grayscale frames showing a camera move entering a room and approaching a Figure" className="block h-auto w-full">
      {[0, 1, 2].map((frame) => {
        const x = frame * 300
        const figureScale = [1, 1.18, 1.38][frame]
        const figureX = [220, 205, 188][frame]
        return (
          <g key={frame} transform={`translate(${x} 0)`}>
            <rect width="296" height="270" x="2" y="0" rx="12" fill="#18181a" stroke="#414145" />
            <path d="M22 210 90 130h112l72 80v42H22z" fill="#55555a" />
            <path d="M22 210 90 130v-70L22 98z" fill="#77777c" />
            <path d="M202 130V60l72 38v112z" fill="#69696e" />
            <path d="M90 130h112V60H90z" fill="#8c8c91" />
            <path d="M117 130V84h48v46" fill="#252528" stroke="#b8b8bc" strokeWidth="3" />
            <path d="M22 210h52l16-80M202 130l16 80h56" fill="none" stroke="#c4c4c8" strokeWidth="2" opacity=".65" />
            <g transform={`translate(${figureX} 0) translate(0 218) scale(${figureScale}) translate(0 -218)`}>
              <circle cx="0" cy="149" r="9" fill="#dedee1" />
              <path d="M0 159v29m0-19-12 15m12-15 12 15m-12 4-9 20m9-20 9 20" fill="none" stroke="#bdbdc1" strokeWidth="6" strokeLinecap="round" />
            </g>
            <rect x="14" y="14" width="46" height="24" rx="12" fill="#2a2a2e" />
            <text x="37" y="30" textAnchor="middle" fill="#e3e3e5" fontSize="12" fontFamily="sans-serif">{frame * 3}s</text>
          </g>
        )
      })}
    </svg>
  )
}

export function TutorialWelcome({ onStart, onClose }: { onStart: () => void; onClose: () => void }) {
  const startRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    startRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="tutorial-welcome-title" className="my-auto w-full max-w-3xl rounded-2xl border border-line bg-panel p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[.16em] text-ink-dim">Guided project · about 10 minutes</p>
            <h2 id="tutorial-welcome-title" className="mt-2 text-2xl font-semibold tracking-tight text-ink">Make your first camera move</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close tutorial preview" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-dim hover:bg-panel-2 hover:text-ink">✕</button>
        </div>

        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
          Edit a small room, place and pose a Figure, then make a six-second camera move through the doorway. Preview the shot and export a reference video.
        </p>

        <div className="mt-5 overflow-hidden rounded-xl border border-line bg-[#111113] p-2 sm:p-3">
          <SampleFrames />
          <p className="px-2 pb-1 pt-3 text-xs text-ink-dim">Example frames · camera approaches the subject through the doorway</p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-panel-2 p-3">
            <h3 className="text-sm font-medium text-ink">Blank project</h3>
            <p className="mt-1 text-xs leading-5 text-ink-dim">Start with an empty scene and choose what to build.</p>
          </div>
          <div className="rounded-lg bg-panel-2 p-3">
            <h3 className="text-sm font-medium text-ink">AI-assisted project</h3>
            <p className="mt-1 text-xs leading-5 text-ink-dim">Use guided planning to shape a production project.</p>
          </div>
        </div>

        <p className="mt-4 text-xs leading-5 text-ink-dim">This lesson creates its own Tutorial project with one scene. Your other projects remain available in Projects.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg px-4 text-sm text-ink-dim hover:bg-panel-2 hover:text-ink">Not now</button>
          <button ref={startRef} type="button" onClick={onStart} className="min-h-11 rounded-lg bg-accent px-5 text-sm font-medium text-white hover:bg-blue-500">Start lesson</button>
        </div>
      </section>
    </div>
  )
}
