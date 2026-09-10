import { useEffect, useState } from 'react'
import { goLibrary, goProjects, switchProject } from '../lib/projects'
import { useProjectCreationStore } from '../state/useProjectCreationStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { useLibraryAssetPicker } from './LibraryAssetPicker'
import { relativeTime } from './ProjectCard'
import { WorkspaceChrome, WorkspacePage } from './WorkspaceChrome'
import { CameraIcon, ImportIcon, ImageIcon, ListIcon, PlusIcon } from './icons'

function newProjectFromHome() {
  useProjectCreationStore.getState().show()
}

function ProjectThumb({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  if (!url) return null
  return (
    <img
      src={url}
      alt=""
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  )
}

export function HomeWorkspace() {
  const picker = useLibraryAssetPicker()
  const projects = useProjectStore((state) => state.projectList)
  const recent = [...projects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3)

  const openProject = async (projectId: string) => {
    await switchProject(projectId)
    useEditorStore.getState().setAppView('editor')
  }

  const tiles = [
    {
      title: 'New project',
      body: 'Start with AI or open a blank scene.',
      icon: <PlusIcon size={22} />,
      onClick: () => void newProjectFromHome(),
    },
    {
      title: 'Import assets',
      body: 'Add a .ply, .splat, .glb or .obj asset to your Library.',
      icon: <ImportIcon size={22} />,
      onClick: () => picker.open(),
    },
    {
      title: 'Library',
      body: 'Open the Account shelf of Locations.',
      icon: <ImageIcon size={22} />,
      onClick: () => void goLibrary(),
    },
    {
      title: 'Projects',
      body: 'Browse the document list.',
      icon: <ListIcon size={22} />,
      onClick: () => void goProjects(),
    },
  ]

  return (
    <WorkspacePage>
      <WorkspaceChrome
        title="Home"
        description="Start work here without a project. New project starts with AI or a blank scene. Import assets lands in Library."
      />
      {picker.input}
      <section aria-label="Start" className="mt-10 grid gap-4 sm:grid-cols-2">
        {tiles.map((tile) => (
          <button
            key={tile.title}
            type="button"
            onClick={tile.onClick}
            className="group flex items-start gap-4 rounded-xl border border-line bg-panel p-6 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-panel-2 hover:shadow-[0_8px_24px_rgb(0_0_0/0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-panel-3 text-ink-dim transition-colors group-hover:bg-accent/15 group-hover:text-accent">
              {tile.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-ink">{tile.title}</span>
              <span className="mt-1.5 block text-sm leading-5 text-ink-dim">{tile.body}</span>
            </span>
          </button>
        ))}
      </section>

      {recent.length > 0 ? (
        <section aria-label="Recent projects" className="mt-14">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-medium text-ink">Recent projects</h2>
            <button
              type="button"
              onClick={() => void goProjects()}
              className="text-[13px] text-ink-dim transition-colors hover:text-ink"
            >
              View all
            </button>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => void openProject(project.id)}
                className="group relative overflow-hidden rounded-xl border border-line bg-panel text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_8px_24px_rgb(0_0_0/0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="relative aspect-video w-full overflow-hidden bg-panel-2">
                  {project.thumbnail ? (
                    <ProjectThumb blob={project.thumbnail} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-panel-2 to-panel-3">
                      <CameraIcon size={30} className="text-ink-dim/40" />
                    </div>
                  )}
                </div>
                <div className="px-4 py-3.5">
                  <h3 className="truncate text-sm font-medium text-ink">{project.name || 'Untitled project'}</h3>
                  <p className="mt-1 text-xs text-ink-dim">
                    {project.scenes.length} {project.scenes.length === 1 ? 'scene' : 'scenes'} ·{' '}
                    {relativeTime(project.updatedAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section
          aria-label="No projects yet"
          className="mt-14 flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-16 text-center"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-panel-2 text-ink-dim/50">
            <CameraIcon size={32} />
          </div>
          <p className="mt-5 text-[15px] font-medium text-ink">No projects yet</p>
          <p className="mt-1.5 max-w-sm text-sm leading-6 text-ink-dim">
            Create your first project to start drawing camera paths in 3D.
          </p>
          <button
            type="button"
            onClick={() => void newProjectFromHome()}
            className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            <PlusIcon size={14} />
            New project
          </button>
        </section>
      )}
    </WorkspacePage>
  )
}
