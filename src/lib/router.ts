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
 *   #/home                           the Home workspace
 *   #/library                        the Account Library
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
import { goHome, goLibrary, goProjects, openBlankProjectSession, switchProject, switchScene } from './projects'
import { CloudApiError } from './cloud/client'

export interface Route {
  view: 'home' | 'library' | 'projects' | 'editor' | 'plan'
  projectId: string | null
  sceneId: string | null
  mode: WorkspaceMode
  /** The Library plan open in the floor-plan editor, when view is 'plan'. */
  planId: string | null
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
    return { view: 'projects', projectId: null, sceneId: null, mode: 'build', planId: null }
  }
  if (segments[0] === 'home') {
    return { view: 'home', projectId: null, sceneId: null, mode: 'build', planId: null }
  }
  // #/library/plan/<id> — the floor-plan editor on a Library plan
  if (segments[0] === 'library' && segments[1] === 'plan' && segments[2]) {
    return { view: 'plan', projectId: null, sceneId: null, mode: 'build', planId: segments[2] }
  }
  if (segments[0] === 'library') {
    return { view: 'library', projectId: null, sceneId: null, mode: 'build', planId: null }
  }

  // #/<mode> — the editor with no project open
  if (segments.length === 1 && isMode(segments[0])) {
    return { view: 'editor', projectId: null, sceneId: null, mode: segments[0], planId: null }
  }

  if (segments[0] !== 'p' || !segments[1]) return null

  const projectId = segments[1]
  // #/p/<id>/<mode> vs #/p/<id>/<sceneId>
  if (segments.length === 3 && isMode(segments[2])) {
    return { view: 'editor', projectId, sceneId: null, mode: segments[2], planId: null }
  }
  return {
    view: 'editor',
    projectId,
    sceneId: segments[2] ?? null,
    mode: isMode(segments[3]) ? segments[3] : 'build',
    planId: null,
  }
}

export function formatRoute(route: Route): string {
  if (route.view === 'home') return '#/home'
  if (route.view === 'library') return '#/library'
  if (route.view === 'projects') return '#/projects'
  if (route.view === 'plan') return `#/library/plan/${encodeURIComponent(route.planId ?? '')}`
  const enc = encodeURIComponent
  if (!route.projectId) return `#/${route.mode}`
  const scene = route.sceneId ? `/${enc(route.sceneId)}` : ''
  return `#/p/${enc(route.projectId)}${scene}/${route.mode}`
}

/** The route the stores currently describe. */
export function routeFromState(): Route {
  const editor = useEditorStore.getState()
  const project = useProjectStore.getState()
  if (editor.appView === 'plan') {
    return { view: 'plan', projectId: null, sceneId: null, mode: 'build', planId: editor.planId }
  }
  return {
    // 'board' is never a resting value — setAppView maps it to editor+compose
    view:
      editor.appView === 'home' || editor.appView === 'library' || editor.appView === 'projects'
        ? editor.appView
        : 'editor',
    projectId: project.projectId || null,
    sceneId: project.activeSceneId || null,
    mode: editor.workspaceMode,
    planId: null,
  }
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

/** Coalesce store writes until the project transition is fully settled. */
const WRITE_DELAY_MS = 80

/** Adopt Tim's hash routes after project boot, keeping persistence and navigation ordered. */
export async function installRouter(options?: { signal?: AbortSignal }): Promise<() => void> {
  let disposed = false
  let applying = false
  let revision = 0
  let writeTimer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()
  let navigation: AbortController | undefined

  function writeUrl(replace: boolean) {
    if (disposed) return
    const next = formatRoute(routeFromState())
    if (next === window.location.hash) return
    const url = `${window.location.pathname}${window.location.search}${next}`
    if (replace) window.history.replaceState(window.history.state, '', url)
    else window.history.pushState(window.history.state, '', url)
  }

  function scheduleWrite() {
    clearTimeout(writeTimer)
    if (disposed || applying || useProjectStore.getState().projectBusy) return
    const scheduledHash = window.location.hash
    writeTimer = setTimeout(() => {
      // Browser navigation can change the URL before hashchange is delivered.
      // A pending editor write must not replace that newer navigation intent.
      if (window.location.hash === scheduledHash && !applying && !useProjectStore.getState().projectBusy) writeUrl(false)
    }, WRITE_DELAY_MS)
  }

  function adopt(route: Route) {
    const adoptedHash = window.location.hash
    const request = ++revision
    navigation?.abort()
    const controller = new AbortController()
    navigation = controller
    const { signal } = controller
    const current = () => !disposed && request === revision && !signal.aborted
    clearTimeout(writeTimer)
    applying = true
    const run = queue.then(async () => {
      if (!current()) return
      try {
        if (route.view === 'home') {
          await goHome(signal)
          return
        }
        if (route.view === 'library') {
          await goLibrary(signal)
          return
        }
        if (route.view === 'projects') {
          await goProjects(signal)
          return
        }
        if (route.view === 'plan') {
          // The floor-plan editor: flush the project, then open the named plan.
          const { goPlan } = await import('./planEditor')
          await goPlan(route.planId, signal)
          return
        }
        if (!route.projectId) {
          await openBlankProjectSession(signal)
        } else if (route.projectId !== useProjectStore.getState().projectId) {
          await switchProject(route.projectId, signal)
          if (!current()) return
          if (useProjectStore.getState().projectId !== route.projectId) {
            await goProjects(signal)
            if (current()) useSceneStore.getState().showNotice('That project link could not be opened')
            return
          }
        }
        if (!current()) return
        if (route.sceneId && route.sceneId !== useProjectStore.getState().activeSceneId) {
          await switchScene(route.sceneId, signal)
        }
        if (!current()) return
        const editor = useEditorStore.getState()
        editor.setAppView('editor')
        editor.setWorkspaceMode(route.mode)
      } catch (error) {
        if (!current()) return
        if (error instanceof CloudApiError && error.status === 404 && error.code === 'project_not_found') {
          await goProjects(signal)
          if (current()) useSceneStore.getState().showNotice('That project link could not be opened')
        } else {
          useSceneStore.getState().showNotice(`Could not open that page: ${error instanceof Error ? error.message : 'Please try again.'}`)
        }
      } finally {
        if (current()) {
          applying = false
          if (window.location.hash === adoptedHash) writeUrl(true)
        }
      }
    })
    queue = run
    return run
  }

  function onHashChange() {
    const route = parseHash(window.location.hash)
    // pushState/replaceState do not emit hashchange; every event is a user route.
    if (route) void adopt(route)
    else writeUrl(true)
  }

  const unsubEditor = useEditorStore.subscribe(scheduleWrite)
  const unsubProject = useProjectStore.subscribe(scheduleWrite)
  window.addEventListener('hashchange', onHashChange)
  function dispose() {
    disposed = true
    revision += 1
    navigation?.abort()
    clearTimeout(writeTimer)
    unsubEditor()
    unsubProject()
    window.removeEventListener('hashchange', onHashChange)
    options?.signal?.removeEventListener('abort', dispose)
  }
  options?.signal?.addEventListener('abort', dispose, { once: true })
  if (options?.signal?.aborted) dispose()
  if (!disposed) {
    const initial = parseHash(window.location.hash)
    if (initial) await adopt(initial)
    else writeUrl(true)
  }
  return dispose
}
