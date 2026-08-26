import type { AppView } from '../state/useEditorStore'

export type WorkspaceKind = 'projects' | 'editor'

/** Which full-page workspace App should mount. */
export function resolveWorkspace(appView: AppView): WorkspaceKind {
  switch (appView) {
    case 'projects':
      return 'projects'
    case 'editor':
    case 'board':
      return 'editor'
    default: {
      const _never: never = appView
      return _never
    }
  }
}
