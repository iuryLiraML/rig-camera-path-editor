import type { AppView } from '../state/useEditorStore'

export type WorkspaceKind = 'home' | 'library' | 'projects' | 'editor' | 'plan'

/** Which full-page workspace App should mount. */
export function resolveWorkspace(appView: AppView): WorkspaceKind {
  switch (appView) {
    case 'home':
      return 'home'
    case 'library':
      return 'library'
    case 'projects':
      return 'projects'
    case 'plan':
      return 'plan'
    case 'editor':
    case 'board':
      return 'editor'
    default: {
      const _never: never = appView
      return _never
    }
  }
}
