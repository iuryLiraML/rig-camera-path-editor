import { describe, expect, it } from 'vitest'
import { formatRoute, parseHash, type Route } from './router'

const route = (over: Partial<Route> = {}): Route => ({
  view: 'editor',
  projectId: null,
  sceneId: null,
  mode: 'build',
  ...over,
})

describe('parseHash', () => {
  it('returns null when the hash names nothing, so boot defaults stand', () => {
    expect(parseHash('')).toBeNull()
    expect(parseHash('#')).toBeNull()
    expect(parseHash('#/')).toBeNull()
    expect(parseHash('#/nonsense')).toBeNull()
    expect(parseHash('#/p')).toBeNull() // 'p' with no project id
  })

  it('reads the projects list', () => {
    expect(parseHash('#/projects')).toEqual(route({ view: 'projects' }))
  })

  it('reads a bare mode as the editor with no project open', () => {
    expect(parseHash('#/compose')).toEqual(route({ mode: 'compose' }))
    expect(parseHash('#/visualize')).toEqual(route({ mode: 'visualize' }))
  })

  it('reads a project, defaulting to Build', () => {
    expect(parseHash('#/p/proj-a')).toEqual(route({ projectId: 'proj-a' }))
  })

  it('tells a mode from a scene id in the third segment', () => {
    // the ambiguous form: scene ids are 'scene-…', modes are the three words
    expect(parseHash('#/p/proj-a/compose')).toEqual(route({ projectId: 'proj-a', mode: 'compose' }))
    expect(parseHash('#/p/proj-a/scene-2')).toEqual(route({ projectId: 'proj-a', sceneId: 'scene-2' }))
  })

  it('reads the full form', () => {
    expect(parseHash('#/p/proj-a/scene-2/visualize')).toEqual(
      route({ projectId: 'proj-a', sceneId: 'scene-2', mode: 'visualize' }),
    )
  })

  it('falls back to Build on an unknown mode rather than rejecting the route', () => {
    expect(parseHash('#/p/proj-a/scene-2/wobble')).toEqual(
      route({ projectId: 'proj-a', sceneId: 'scene-2', mode: 'build' }),
    )
  })

  it('decodes escaped ids and survives a malformed escape', () => {
    expect(parseHash('#/p/my%20proj/scene%201/build')).toEqual(
      route({ projectId: 'my proj', sceneId: 'scene 1', mode: 'build' }),
    )
    expect(parseHash('#/p/100%/scene-1')?.projectId).toBe('100%')
  })

  it('ignores extra slashes', () => {
    expect(parseHash('#//p//proj-a//scene-2//compose')).toEqual(
      route({ projectId: 'proj-a', sceneId: 'scene-2', mode: 'compose' }),
    )
  })
})

describe('formatRoute', () => {
  it('writes each shape', () => {
    expect(formatRoute(route({ view: 'projects' }))).toBe('#/projects')
    expect(formatRoute(route({ mode: 'compose' }))).toBe('#/compose')
    expect(formatRoute(route({ projectId: 'proj-a' }))).toBe('#/p/proj-a/build')
    expect(formatRoute(route({ projectId: 'proj-a', sceneId: 'scene-2', mode: 'visualize' }))).toBe(
      '#/p/proj-a/scene-2/visualize',
    )
  })

  it('escapes ids so a stray slash cannot invent a segment', () => {
    expect(formatRoute(route({ projectId: 'a/b' }))).toBe('#/p/a%2Fb/build')
  })
})

describe('round trip', () => {
  const cases: Route[] = [
    route({ view: 'projects' }),
    route({ mode: 'compose' }),
    route({ mode: 'visualize' }),
    route({ projectId: 'proj-a' }),
    route({ projectId: 'proj-a', mode: 'compose' }),
    route({ projectId: 'proj-a', sceneId: 'scene-legacy', mode: 'visualize' }),
    route({ projectId: 'a/b', sceneId: 'c d', mode: 'build' }),
  ]

  it('parses back to what it formatted', () => {
    // the sync loop compares formatted strings, so a lossy round trip would
    // rewrite the URL forever
    for (const original of cases) {
      expect(parseHash(formatRoute(original))).toEqual(original)
    }
  })
})
