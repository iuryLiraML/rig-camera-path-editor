import type { ReactNode } from 'react'
import { goHome, goLibrary, goProjects } from '../lib/projects'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { AccountMenu } from './AccountMenu'

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'library', label: 'Library' },
  { id: 'projects', label: 'Projects' },
] as const

const GO = {
  home: goHome,
  library: goLibrary,
  projects: goProjects,
} as const

export function WorkspacePill() {
  const appView = useEditorStore((state) => state.appView)

  return (
    <nav aria-label="Workspaces" className="inline-flex rounded-full border border-line bg-panel-2 p-1">
      {TABS.map((tab) => {
        const current = appView === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={current ? 'page' : undefined}
            onClick={() => void GO[tab.id]()}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              current
                ? 'bg-panel-3 text-ink shadow-sm ring-1 ring-accent/40'
                : 'text-ink-dim hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}

export function WorkspaceChrome({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  const notice = useSceneStore((state) => state.notice)
  return (
    <header className="flex flex-col gap-6 border-b border-line/60 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WorkspacePill />
        <AccountMenu />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight tracking-tight">{title}</h1>
          {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-dim">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {notice ? (
        <p role="status" className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink">
          {notice}
        </p>
      ) : null}
    </header>
  )
}

export function WorkspacePage({ children }: { children: ReactNode }) {
  return (
    <main className="h-full select-text overflow-auto bg-[#0f0f11] px-6 py-8 text-ink selection:bg-accent/30 sm:px-10 lg:px-14 lg:py-10">
      <div className="mx-auto max-w-6xl">{children}</div>
    </main>
  )
}
