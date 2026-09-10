import { useState } from 'react'
import { createFolder, projectsInFolder, renameFolder, unfiledProjects } from '../lib/folders'
import {
  deleteProject,
  moveProjectToFolder,
  removeFolder,
  renameProject,
  renameScene,
  switchProject,
  switchScene,
} from '../lib/projects'
import { useProjectCreationStore } from '../state/useProjectCreationStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { PlusIcon, SearchIcon } from './icons'
import { ProjectCard } from './ProjectCard'
import { WorkspaceChrome, WorkspacePage } from './WorkspaceChrome'

export function ProjectsWorkspace() {
  const projects = useProjectStore((state) => state.projectList)
  const folders = useProjectStore((state) => state.folderList)
  const activeProjectId = useProjectStore((state) => state.projectId)
  const projectBusy = useProjectStore((state) => state.projectBusy)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const openFolder = folders.find((folder) => folder.id === openFolderId) ?? null
  const needle = query.trim().toLowerCase()
  const homeList = openFolder ? projectsInFolder(projects, openFolder.id) : unfiledProjects(projects)
  const searchPool = !openFolder && needle ? projects : homeList
  const visible = needle
    ? searchPool.filter((project) => project.name.toLowerCase().includes(needle))
    : homeList

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
      await switchScene(sceneId)
      useEditorStore.getState().setAppView('editor')
    } catch {
      setError('The scene could not be opened. Your current project remains unchanged.')
    }
  }

  const newProject = () => useProjectCreationStore.getState().show(openFolderId)

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

  return (
    <WorkspacePage>
      <WorkspaceChrome
        title={openFolder ? openFolder.name : 'Projects'}
        description={
          openFolder
            ? `${visible.length} ${visible.length === 1 ? 'project' : 'projects'} in this folder`
            : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`
        }
        actions={
          <>
            <label className="relative">
              <SearchIcon
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects"
                aria-label="Search projects"
                className="w-56 rounded-lg border border-line bg-panel-2 py-2 pl-8 pr-3 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-accent"
              />
            </label>
            {!openFolder && (
              <button
                type="button"
                onClick={() => void newFolder()}
                className="rounded-lg border border-line bg-panel-2 px-3.5 py-2 text-sm text-ink hover:bg-panel-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                New folder
              </button>
            )}
            <button
              type="button"
              disabled={projectBusy}
              onClick={() => void newProject()}
              title="Opens Build with an empty scene"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f11]"
            >
              <PlusIcon size={14} />
              {projectBusy ? 'Working…' : 'New project'}
            </button>
          </>
        }
      />
      {openFolder ? (
        <button
          type="button"
          onClick={() => setOpenFolderId(null)}
          className="mt-4 text-xs text-ink-dim hover:text-ink"
        >
          ← All projects
        </button>
      ) : null}
      {!openFolder && folders.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2" role="tablist" aria-label="Folders">
              <button
                type="button"
                role="tab"
                aria-selected
                className="rounded-full bg-panel-3 px-3 py-1 text-xs text-ink"
              >
                Unfiled · {unfiledProjects(projects).length}
              </button>
              {folders.map((folder) => {
                const count = projectsInFolder(projects, folder.id).length
                return (
                  <div key={folder.id} className="flex items-center rounded-full border border-line bg-panel-2">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={false}
                      onClick={() => setOpenFolderId(folder.id)}
                      className="px-3 py-1 text-xs text-ink-dim hover:text-ink"
                    >
                      {folder.name} · {count}
                    </button>
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
                        className="mr-1 w-28 rounded-md border border-line bg-panel px-1.5 py-0.5 text-[11px] text-ink outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        title={`Rename ${folder.name}`}
                        onClick={() => {
                          setRenamingId(folder.id)
                          setRenameValue(folder.name)
                        }}
                        className="px-1.5 text-[10px] text-ink-dim hover:text-ink"
                      >
                        Rename
                      </button>
                    )}
                    <button
                      type="button"
                      title={`Delete ${folder.name}`}
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
                      className="pr-2.5 text-[10px] text-ink-dim hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                )
              })}
            </div>
          )}
      {error && (
        <p role="alert" className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <section data-projects-grid aria-labelledby="project-list-title" className="mt-8">
        <h2 id="project-list-title" className="sr-only">
          {openFolder ? openFolder.name : needle ? 'Search results' : 'Unfiled projects'}
        </h2>
        <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
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
                onRename={(name) =>
                  void renameProject(project.id, name).catch(() =>
                    setError('The project could not be renamed.'),
                  )
                }
                onRenameScene={(sceneId, name) =>
                  void renameScene(sceneId, name, project.id).catch(() =>
                    setError('The scene could not be renamed.'),
                  )
                }
                onDelete={() =>
                  void deleteProject(project.id).catch(() =>
                    setError('The project could not be deleted.'),
                  )
                }
              />
            ))}
            <button
              type="button"
              disabled={projectBusy}
              onClick={() => void newProject()}
              title="Opens Build with an empty scene"
              className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-ink-dim transition-colors hover:border-accent/60 hover:text-ink disabled:cursor-wait"
            >
              <PlusIcon size={18} />
              <span className="text-xs">New project</span>
            </button>
          </div>
          {homeList.length === 0 && !needle && (
            <p className="mt-6 text-sm text-ink-dim">
              {openFolder
                ? 'This folder is empty. Create a project to start a camera move.'
                : 'No projects yet. New project opens an empty scene. Import assets on Home adds a palco to your Library first.'}
            </p>
          )}
          {visible.length === 0 && needle && (
            <p className="mt-6 text-sm text-ink-dim">No project matches “{query}”.</p>
          )}
        </section>
    </WorkspacePage>
  )
}
