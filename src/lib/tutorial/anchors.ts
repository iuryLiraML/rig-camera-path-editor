import { useEditorStore } from '../../state/useEditorStore'
import { useSceneStore } from '../../state/useSceneStore'

/**
 * Per-step anchoring for the interactive coachmark tour (issue #78). For each
 * step: `setup` puts the editor in the state that reveals the taught control,
 * `selector` is a stable hook for the spotlight highlight + popover anchor, and
 * `placement` is the preferred popover side. Steps with no single control
 * (welcome) use a centered card. Selectors resolve to controls that carry a
 * `data-tour` / `data-primitive` / `data-animate-menu` attribute.
 */
export type CoachmarkPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center'

export interface TutorialAnchor {
  selector: string | null
  placement: CoachmarkPlacement
  setup: () => void
}

const editor = () => useEditorStore.getState()

export const TUTORIAL_ANCHORS: Record<string, TutorialAnchor> = {
  welcome: {
    selector: null,
    placement: 'center',
    // No control to reveal; reset to the default editor view (also unwinds any
    // leftover Library/Compose state on replay).
    setup: () => {
      const e = editor()
      e.setAppView('editor')
      e.setWorkspaceMode('build')
    },
  },
  plan: {
    selector: '[data-tour="library-new-plan"]',
    placement: 'bottom',
    setup: () => editor().setAppView('library'),
  },
  figure: {
    selector: '[data-primitive="female"]',
    placement: 'top',
    setup: () => {
      const e = editor()
      e.setAppView('editor')
      e.openAddDrawerChip('figures')
    },
  },
  camera: {
    selector: '[data-tour="camera-add"]',
    placement: 'right',
    // Order matters: appView forces compose, build re-enables the outliner.
    setup: () => {
      const e = editor()
      e.setAppView('editor')
      e.setWorkspaceMode('build')
      e.setShowOutliner(true)
    },
  },
  path: {
    selector: '[data-tour="pen-tool"]',
    placement: 'bottom',
    // Compose gates the Pen; arming the tool forces the main-row button to render.
    setup: () => {
      const e = editor()
      e.setAppView('editor')
      e.setWorkspaceMode('compose')
      e.setTool('pen')
    },
  },
  keyframe: {
    selector: '[data-animate-menu]',
    placement: 'top',
    setup: () => {
      const e = editor()
      e.setPlayMode(false)
      e.setAppView('editor')
      e.setWorkspaceMode('compose')
      // The add-key control is disabled with nothing selected — select the figure
      // (or the camera) so the user can actually key a property.
      const dummy = useSceneStore.getState().objects.find((o) => o.rigKind === 'dummy')
      e.select(dummy ? `obj:${dummy.id}` : 'cinema-camera')
    },
  },
  export: {
    selector: '[data-tour="export"]',
    placement: 'bottom',
    // Leave exportMenuOpen false — opening it is the step's completion action.
    setup: () => {
      const e = editor()
      e.setAppView('editor')
      e.setWorkspaceMode('compose')
    },
  },
}
