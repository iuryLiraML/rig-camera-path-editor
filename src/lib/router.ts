/**
 * Hash routing — the app's pages in the URL.
 *
 * Before this, every view lived only in `useEditorStore`, which is not
 * persisted, so a refresh always landed on the Build canvas. Worse, on the
 * local (non-cloud) path `bootProjects` finishes with
 * `initializeBlankProjectSession()`, so a refresh also dropped the open
 * project for a blank "Untitled" — the URL is now what carries you back.
 *
 * Deliberately hash-based, not path-based: the deployment has no SPA fallback
 * rewrite, so `/p/foo/build` returns Vercel's own 404. A hash never reaches
 * the server, so this needs no hosting change and cannot 404.
 *
 * Grammar:
 *   #/projects                       the projects list
 *   #/<mode>                         editor, no project open (blank session)
 *   #/p/<projectId>                  editor, project, Build
 *   #/p/<projectId>/<mode>           editor, project, that mode
 *   #/p/<projectId>/<sceneId>        editor, project, scene, Build
 *   #/p/<projectId>/<sceneId>/<mode> the full form
 *
 * Scene ids and mode names can't collide (`scene-…` vs build/compose/
 * visualize), so the 3-segment form is unambiguous.
 */

import { useEditorStore, type WorkspaceMode } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { useSceneStore } from '../state/useSceneStore'
import { switchProject, switchScene } from './projects'

export interface Route {
  view: 'projects' | 'editor'
  projectId: string | null
  sceneId: string | null
  mode: WorkspaceMode
}

const MODES = ['build', 'compose', 'visualize'] as const

function isMode(value: string | undefined): value is WorkspaceMode {
  return value !== undefined && (MODES as readonly string[]).includes(value)
}

/** A route, or null when the hash names nothing we recognise (so: use defaults). */
export function parseHash(hash: string): Route | null {
  const segments = hash
    .replace(/^#/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment // a malformed % escape is still a usable literal
      }
    })

  if (segments.length === 0) return null

  if (segments[0] === 'projects') {
    return { view: 'projects', projectId: null, sceneId: null, mode: 'build' }
  }

  // #/<mode> — the editor with no project open
  if (segments.length === 1 && isMode(segments[0])) {
    return { view: 'editor', projectId: null, sceneId: null, mode: segments[0] }
  }

  if (segments[0] !== 'p' || !segments[1]) return null

  const projectId = segments[1]
  // #/p/<id>/<mode> vs #/p/<id>/<sceneId>
  if (segments.length === 3 && isMode(segments[2])) {
    return { view: 'editor', projectId, sceneId: null, mode: segments[2] }
  }
  return {
    view: 'editor',
    projectId,
    sceneId: segments[2] ?? null,
    mode: isMode(segments[3]) ? segments[3] : 'build',
  }
}

export function formatRoute(route: Route): string {
  if (route.view === 'projects') return '#/projects'
  const enc = encodeURIComponent
  if (!route.projectId) return `#/${route.mode}`
  const scene = route.sceneId ? `/${enc(route.sceneId)}` : ''
  return `#/p/${enc(route.projectId)}${scene}/${route.mode}`
}

/** The route the stores currently describe. */
export function routeFromState(): Route {
  const editor = useEditorStore.getState()
  const project = useProjectStore.getState()
  return {
    // 'board' is never a resting value — setAppView maps it to editor+compose
    view: editor.appView === 'projects' ? 'projects' : 'editor',
    projectId: project.projectId || null,
    sceneId: project.activeSceneId || null,
    mode: editor.workspaceMode,
  }
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

/** Set while the URL is driving the stores, so the sync doesn't write back. */
let applying = false
/** The last hash this module wrote, to tell our own writes from a real Back. */
let lastWritten: string | null = null
let writeTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Project and scene switches touch several stores across awaits, so writing on
 * every store event would push a history entry per intermediate state. One
 * coalesced write per settled state keeps Back meaning "the previous page".
 */
const WRITE_DELAY_MS = 80

function writeUrl(replace: boolean) {
  const next = formatRoute(routeFromState())
  if (next === (window.location.hash || '')) {
    lastWritten = next
    return
  }
  lastWritten = next
  const url = `${window.location.pathname}${window.location.search}${next}`
  if (replace) window.history.replaceState(window.history.state, '', url)
  else window.history.pushState(window.history.state, '', url)
}

function scheduleWrite() {
  if (applying) return
  clearTimeout(writeTimer)
  writeTimer = setTimeout(() => writeUrl(false), WRITE_DELAY_MS)
}

async function applyRoute(route: Route) {
  applying = true
  try {
    const editor = useEditorStore.getState()

    if (route.view === 'projects') {
      editor.setAppView('projects')
      return
    }

    if (route.projectId && route.projectId !== useProjectStore.getState().projectId) {
      await switchProject(route.projectId)
      // switchProject is a no-op for an id that isn't in storage (deleted, or
      // another account's) — say so rather than leaving a blank canvas
      if (useProjectStore.getState().projectId !== route.projectId) {
        useSceneStore.getState().showNotice('That project link could not be opened')
        useEditorStore.getState().setAppView('projects')
        return
      }
    }

    if (route.sceneId && route.sceneId !== useProjectStore.getState().activeSceneId) {
      await switchScene(route.sceneId)
    }

    const fresh = useEditorStore.getState()
    fresh.setAppView('editor')
    fresh.setWorkspaceMode(route.mode)
  } finally {
    applying = false
    // the stores may have settled somewhere other than the URL asked for
    // (an unknown scene id, say) — make the URL tell the truth
    writeUrl(true)
  }
}

function onHashChange() {
  const hash = window.location.hash || ''
  if (hash === lastWritten) return // our own write echoing back
  const route = parseHash(hash)
  if (route) void applyRoute(route)
}

/**
 * Adopt the URL if it names a page, then keep the two in sync. Call once, after
 * `bootProjects()` — boot decides which project is open, and an initial route
 * has to override that.
 */
export async function installRouter(): Promise<() => void> {
  const initial = parseHash(window.location.hash || '')
  if (initial) await applyRoute(initial)
  else writeUrl(true) // stamp the current state so Back has somewhere to go

  const unsubEditor = useEditorStore.subscribe(scheduleWrite)
  const unsubProject = useProjectStore.subscribe(scheduleWrite)
  window.addEventListener('hashchange', onHashChange)

  return () => {
    clearTimeout(writeTimer)
    unsubEditor()
    unsubProject()
    window.removeEventListener('hashchange', onHashChange)
  }
}
