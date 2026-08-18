import { useCallback, useState } from 'react'
import { isTeamCloudApp } from '../lib/cloud/client'
import { createFolder, projectsInFolder, renameFolder, unfiledProjects } from '../lib/folders'
import {
  bootProjects,
  createProject,
  loadShot,
  moveProjectToFolder,
  removeFolder,
  switchProject,
} from '../lib/projects'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { GoogleSignInButton } from './GoogleSignInButton'
import { ProjectCard } from './ProjectCard'

function FolderGlyph() {
  return (
    <svg width="28" height="22" viewBox="0 0 28 22" fill="none" aria-hidden className="text-ink-dim">
      <path
        d="M1.5 5.5A2 2 0 0 1 3.5 3.5h6.2l1.6 2H24.5A2 2 0 0 1 26.5 7.5v11A2 2 0 0 1 24.5 20.5h-21A2 2 0 0 1 1.5 18.5v-13Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function ProjectsWorkspace() {
  const projects = useProjectStore((state) => state.projectList)
  const folders = useProjectStore((state) => state.folderList)
  const activeProjectId = useProjectStore((state) => state.projectId)
  const projectBusy = useProjectStore((state) => state.projectBusy)
  const cloudStatus = useCloudAuthStore((state) => state.status)
  const cloudSession = useCloudAuthStore((state) => state.session)
  const cloudError = useCloudAuthStore((state) => state.error)
  const [error, setError] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [query, setQuery] = useState('')
  const [cloudOpen, setCloudOpen] = useState(false)
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const openFolder = folders.find((folder) => folder.id === openFolderId) ?? null
  const scoped = openFolder ? projectsInFolder(projects, openFolder.id) : unfiledProjects(projects)
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? scoped.filter((project) => project.name.toLowerCase().includes(needle))
    : scoped

  const openProject = async (projectId: string) => {
    setError(null)
    try {
      await switchProject(projectId)
      useEditorStore.getState().setAppView('editor')
    } catch {
      setError('The project could not be opened. Your current project remains unchanged.')
    }
  }

  const openScene = async (projectId: string, sceneId: string) => {
    setError(null)
    try {
      await switchProject(projectId)
      const shot = useProjectStore.getState().shots.find((item) => item.id === sceneId)
      if (shot) loadShot(shot)
      else useEditorStore.getState().setAppView('editor')
    } catch {
      setError('The scene could not be opened. Your current project remains unchanged.')
    }
  }

  const newProject = async () => {
    setError(null)
    try {
      await createProject('New project', openFolderId)
      useEditorStore.getState().setAppView('editor')
    } catch (error) {
      console.error('createProject failed', error)
      setError('The new project could not be created. Please try again.')
    }
  }

  const newFolder = async () => {
    setError(null)
    try {
      const folder = await createFolder('Untitled folder')
      useProjectStore.getState().setFolderList(
        [...useProjectStore.getState().folderList, folder].sort(
          (a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt,
        ),
      )
      setRenamingId(folder.id)
      setRenameValue(folder.name)
    } catch {
      setError('The folder could not be created. Please try again.')
    }
  }

  const commitRename = async () => {
    if (!renamingId) return
    const next = await renameFolder(renamingId, renameValue)
    if (next) {
      useProjectStore.getState().setFolderList(
        useProjectStore.getState().folderList
          .map((folder) => (folder.id === next.id ? next : folder))
          .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt),
      )
    }
    setRenamingId(null)
  }

  const signInWithToken = async (token: string) => {
    setConnecting(true)
    setError(null)
    try {
      await useCloudAuthStore.getState().setAccessToken(token)
      if (useCloudAuthStore.getState().status === 'error') {
        setError(useCloudAuthStore.getState().error ?? 'Cloud sign-in failed.')
        return
      }
      if (useCloudAuthStore.getState().status === 'signed-in') {
        await bootProjects()
      }
    } finally {
      setConnecting(false)
    }
  }

  const connectCloud = () => signInWithToken(tokenInput)
  const onGoogleCredential = useCallback((idToken: string) => {
    void signInWithToken(idToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const teamApp = isTeamCloudApp()
  const signedIn = cloudStatus === 'signed-in'
  const blocked = teamApp && !signedIn

  if (blocked) {
    return (
      <main className="flex h-full select-text items-center justify-center bg-[#0f0f11] px-6 text-ink selection:bg-accent/30">
        <div className="w-full max-w-md rounded-xl border border-line bg-panel p-8">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Rig</h1>
          <p className="mt-2 text-sm leading-6 text-ink-dim">
            Studio access is Google-only. Use an allowlisted account to open your projects.
          </p>
          <div className="mt-6">
            <GoogleSignInButton onCredential={onGoogleCredential} />
          </div>
          {(error || cloudError) && (
            <p role="alert" className="mt-4 text-sm text-red-300">
              {error ?? cloudError}
            </p>
          )}
          {connecting || cloudStatus === 'checking' ? (
            <p className="mt-4 text-xs text-ink-dim">Signing in…</p>
          ) : null}
        </div>
      </main>
    )
  }

  return (
    <main className="h-full select-text overflow-auto bg-[#0f0f11] px-6 py-10 text-ink selection:bg-accent/30 sm:px-10 lg:px-16 lg:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            {openFolder ? (
              <button
                type="button"
                onClick={() => setOpenFolderId(null)}
                className="text-xs text-ink-dim hover:text-ink"
              >
                ← All projects
              </button>
            ) : null}
            <h1 className="text-2xl font-semibold tracking-tight">
              {openFolder ? openFolder.name : 'Projects'}
            </h1>
            <p className="mt-1.5 text-sm text-ink-dim">
              {openFolder
                ? 'Projects and saved scenes in this folder.'
                : 'Folders hold projects. Each project keeps saved scenes and versions.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {signedIn && cloudSession ? (
              <div className="mr-2 flex items-center gap-2">
                {cloudSession.picture ? (
                  <img
                    src={cloudSession.picture}
                    alt=""
                    className="h-8 w-8 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                <span className="max-w-[14rem] truncate text-xs text-ink-dim">
                  {cloudSession.email ?? cloudSession.name ?? cloudSession.userId}
                </span>
                <button
                  type="button"
                  onClick={() => void useCloudAuthStore.getState().signOut()}
                  className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink hover:bg-panel-3"
                >
                  Sign out
                </button>
              </div>
            ) : null}
            {!openFolder && (
              <button
                type="button"
                onClick={() => void newFolder()}
                className="rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm text-ink hover:bg-panel-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                New folder
              </button>
            )}
            <button
              type="button"
              disabled={projectBusy}
              onClick={() => void newProject()}
              title="Opens the editor with the Director pane"
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

        {!openFolder && folders.length > 0 && (
          <section aria-labelledby="folder-list-title" className="mt-8">
            <h2 id="folder-list-title" className="text-sm font-semibold">
              Folders
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {folders.map((folder) => {
                const count = projectsInFolder(projects, folder.id).length
                return (
                  <div
                    key={folder.id}
                    className="flex flex-col overflow-hidden rounded-xl border border-line bg-panel"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFolderId(folder.id)}
                      className="flex aspect-[5/3] flex-col items-start justify-between p-4 text-left hover:bg-panel-2"
                    >
                      <FolderGlyph />
                      <span className="mt-auto">
                        <span className="block truncate text-sm font-medium text-ink">{folder.name}</span>
                        <span className="mt-0.5 block text-xs text-ink-dim">
                          {count} {count === 1 ? 'project' : 'projects'}
                        </span>
                      </span>
                    </button>
                    <div className="flex items-center gap-2 border-t border-line px-3 py-2">
                      {renamingId === folder.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onBlur={() => void commitRename()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void commitRename()
                            if (event.key === 'Escape') setRenamingId(null)
                          }}
                          className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 py-1 text-[11px] text-ink outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(folder.id)
                            setRenameValue(folder.name)
                          }}
                          className="text-[11px] text-ink-dim hover:text-ink"
                        >
                          Rename
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete “${folder.name}”? Projects inside move back to All projects.`,
                            )
                          ) {
                            void removeFolder(folder.id).then(() => {
                              if (openFolderId === folder.id) setOpenFolderId(null)
                            })
                          }
                        }}
                        className="ml-auto text-[11px] text-ink-dim hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section aria-labelledby="project-list-title" className="mt-8">
          <div className="flex items-center justify-between gap-4">
            <h2 id="project-list-title" className="text-sm font-semibold">
              {openFolder ? 'Projects' : 'Unfiled'} · {visible.length}
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
                folders={folders}
                onOpen={() => void openProject(project.id)}
                onOpenScene={(sceneId) => void openScene(project.id, sceneId)}
                onMove={(folderId) => void moveProjectToFolder(project.id, folderId)}
              />
            ))}
            <button
              type="button"
              disabled={projectBusy}
              onClick={() => void newProject()}
              title="Opens the editor with the Director pane"
              className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-ink-dim transition-colors hover:border-accent/60 hover:text-ink disabled:cursor-wait"
            >
              <span className="text-xl leading-none">+</span>
              <span className="text-xs">New project</span>
            </button>
          </div>
          {scoped.length === 0 && (
            <p className="mt-6 text-sm text-ink-dim">
              {openFolder
                ? 'This folder is empty. Create a project to start a camera move.'
                : 'No unfiled projects. Create one, or open a folder.'}
            </p>
          )}
          {scoped.length > 0 && visible.length === 0 && (
            <p className="mt-6 text-sm text-ink-dim">No project matches “{query}”.</p>
          )}
        </section>

        {!teamApp && (
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
                    Signed-in projects sync to the private backend. Provider keys can be stored in
                    the encrypted vault instead of this browser.
                  </p>
                  {cloudStatus === 'signed-in' && cloudSession ? (
                    <button
                      type="button"
                      onClick={() => void useCloudAuthStore.getState().signOut()}
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
        )}
      </div>
    </main>
  )
}
