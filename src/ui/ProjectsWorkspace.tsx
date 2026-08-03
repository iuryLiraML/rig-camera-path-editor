import { useCallback, useState } from 'react'
import { createProject, switchProject } from '../lib/projects'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { GoogleSignInButton } from './GoogleSignInButton'
import { ProjectCard } from './ProjectCard'

export function ProjectsWorkspace() {
  const projects = useProjectStore((state) => state.projectList)
  const activeProjectId = useProjectStore((state) => state.projectId)
  const projectBusy = useProjectStore((state) => state.projectBusy)
  const cloudStatus = useCloudAuthStore((state) => state.status)
  const cloudSession = useCloudAuthStore((state) => state.session)
  const cloudError = useCloudAuthStore((state) => state.error)
  const [error, setError] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [query, setQuery] = useState('')
  // cloud sign-in is a setup step, not something to read past every visit —
  // it used to sit above the user's own projects, taking the best position on
  // the screen for a development access token field
  const [cloudOpen, setCloudOpen] = useState(false)

  const openProject = async (projectId: string) => {
    setError(null)
    try {
      await switchProject(projectId)
      useEditorStore.getState().setAppView('editor')
    } catch {
      setError('The project could not be opened. Your current project remains unchanged.')
    }
  }

  /**
   * `guided` decides where a new project starts: the intake interview (context
   * for the director agent) or straight into the 3D editor. Setup is optional,
   * so the plain "New project" path unlocks the editor immediately.
   */
  const newProject = async (guided = false) => {
    setError(null)
    try {
      await createProject()
      if (!guided) {
        const store = useProjectStore.getState()
        store.setWorkflow({ ...store.workflow, legacyEditorAccess: true })
      }
      useEditorStore.getState().setAppView('editor')
    } catch {
      setError('The new project could not be created. Please try again.')
    }
  }

  const signInWithToken = async (token: string) => {
    setConnecting(true)
    setError(null)
    try {
      await useCloudAuthStore.getState().setAccessToken(token)
      if (useCloudAuthStore.getState().status === 'error') {
        setError(useCloudAuthStore.getState().error ?? 'Cloud sign-in failed.')
      }
    } finally {
      setConnecting(false)
    }
  }

  const connectCloud = () => signInWithToken(tokenInput)

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? projects.filter((project) => project.name.toLowerCase().includes(needle))
    : projects

  // Google returns an ID token; the API verifies it against Google's JWKS.
  const onGoogleCredential = useCallback((idToken: string) => {
    void signInWithToken(idToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="h-full select-text overflow-auto bg-[#0f0f11] px-6 py-10 text-ink selection:bg-accent/30 sm:px-10 lg:px-16 lg:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-1.5 text-sm text-ink-dim">
              Open a project, or start a new camera move.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={projectBusy}
              onClick={() => void newProject(true)}
              title="Start with the guided setup: brief, director interview, PRD and shot list"
              className="rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm text-ink hover:bg-panel-3 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Guided setup
            </button>
            <button
              type="button"
              disabled={projectBusy}
              onClick={() => void newProject()}
              title="Go straight to the 3D editor — you can run the setup later"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f11]"
            >
              {projectBusy ? 'Working…' : 'New project'}
            </button>
          </div>
        </header>
        {error && (
          <p role="alert" className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <section aria-labelledby="project-list-title" className="mt-8">
          <div className="flex items-center justify-between gap-4">
            <h2 id="project-list-title" className="text-sm font-semibold">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </h2>
            {projects.length > 4 && (
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects"
                aria-label="Search projects"
                className="w-56 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent"
              />
            )}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visible.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                active={project.id === activeProjectId}
                busy={projectBusy}
                onOpen={() => void openProject(project.id)}
              />
            ))}
            {/* a new project belongs in the grid, next to the others */}
            <button
              type="button"
              disabled={projectBusy}
              onClick={() => void newProject()}
              title="Go straight to the 3D editor — you can run the setup later"
              className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-ink-dim transition-colors hover:border-accent/60 hover:text-ink disabled:cursor-wait"
            >
              <span className="text-xl leading-none">+</span>
              <span className="text-xs">New project</span>
            </button>
          </div>
          {projects.length > 0 && visible.length === 0 && (
            <p className="mt-6 text-sm text-ink-dim">No project matches “{query}”.</p>
          )}
        </section>

        <section aria-labelledby="cloud-account-title" className="mt-10 border-t border-line pt-6">
          <button
            type="button"
            onClick={() => setCloudOpen((open) => !open)}
            aria-expanded={cloudOpen}
            className="flex items-center gap-2 text-sm text-ink-dim hover:text-ink"
          >
            <span className={`text-[10px] transition-transform ${cloudOpen ? 'rotate-90' : ''}`}>
              &#9656;
            </span>
            <span id="cloud-account-title" className="font-medium">
              Cloud account
            </span>
            <span className="text-xs">
              {cloudStatus === 'signed-in' ? '· connected' : '· not connected'}
            </span>
          </button>
          {cloudOpen && (
            <div className="mt-4 rounded-xl border border-line bg-panel p-5">

          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="max-w-2xl text-xs leading-5 text-ink-dim">
              Signed-in projects sync workflow drafts to the private backend. Provider keys can be
              stored in the encrypted vault instead of this browser.
            </p>
            {cloudStatus === 'signed-in' && cloudSession ? (
              <button
                type="button"
                onClick={() => useCloudAuthStore.getState().signOut()}
                className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-ink hover:bg-panel-3"
              >
                Sign out
              </button>
            ) : null}
          </div>
          {cloudStatus === 'signed-in' && cloudSession ? (
            <p className="mt-4 text-xs text-ink-dim">
              Connected as <span className="text-ink">{cloudSession.userId}</span> · tenant{' '}
              <span className="font-mono text-[10px] text-ink">{cloudSession.tenantId}</span>
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <GoogleSignInButton onCredential={onGoogleCredential} />
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  placeholder="Development access token"
                  className="min-w-[240px] flex-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
                <button
                  type="button"
                  disabled={connecting || !tokenInput.trim()}
                  onClick={() => void connectCloud()}
                  className="rounded-lg bg-panel-2 px-4 py-2 text-sm text-ink hover:bg-panel-3 disabled:opacity-50"
                >
                  {connecting ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </div>
          )}
          {cloudError && cloudStatus === 'error' && (
            <p role="alert" className="mt-3 text-xs text-red-400">
              {cloudError}
            </p>
          )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
