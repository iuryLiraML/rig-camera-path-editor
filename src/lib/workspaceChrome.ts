import type { ComposeDock, WorkspaceMode } from '../state/useEditorStore'

export interface EditorChromeFlags {
  toolbar: boolean
  modeSwitcher: boolean
  projectChip: boolean
  outliner: boolean
  addDrawer: boolean
  objectBar: boolean
  timeline: boolean
  sequence: boolean
  composeTabs: boolean
  shotFrame: boolean
  cameraBar: boolean
  addShot: boolean
  visualizeRail: boolean
  directorDock: boolean
  footer: boolean
  navLegend: boolean
  pip: boolean
  cameraHud: boolean
  onboarding: boolean
}

export function editorChrome(input: {
  playMode: boolean
  workspaceMode: WorkspaceMode
  composeDock: ComposeDock
  showOutliner: boolean
  showAddDrawer: boolean
}): EditorChromeFlags {
  if (input.playMode) {
    return {
      toolbar: false,
      modeSwitcher: false,
      projectChip: false,
      outliner: false,
      addDrawer: false,
      objectBar: false,
      timeline: false,
      sequence: false,
      composeTabs: false,
      shotFrame: false,
      cameraBar: false,
      addShot: false,
      visualizeRail: false,
      directorDock: false,
      footer: false,
      navLegend: false,
      pip: false,
      cameraHud: false,
      onboarding: false,
    }
  }

  const mode = input.workspaceMode
  switch (mode) {
    case 'build':
      return {
        toolbar: true,
        modeSwitcher: true,
        projectChip: true,
        outliner: input.showOutliner,
        addDrawer: input.showAddDrawer,
        objectBar: true,
        timeline: false,
        sequence: false,
        composeTabs: false,
        shotFrame: false,
        cameraBar: false,
        addShot: false,
        visualizeRail: false,
        directorDock: true,
        footer: false,
        navLegend: true,
        pip: false,
        cameraHud: false,
        onboarding: true,
      }
    case 'compose':
      return {
        toolbar: true,
        modeSwitcher: true,
        projectChip: true,
        outliner: input.showOutliner,
        addDrawer: false,
        // Pose keys live on the timeline; hiding the object bar here made the
        // Transform diamonds disappear the moment the user left Build.
        objectBar: true,
        timeline: input.composeDock === 'timeline',
        sequence: input.composeDock === 'sequence',
        composeTabs: true,
        shotFrame: false,
        cameraBar: true,
        addShot: false,
        visualizeRail: false,
        directorDock: true,
        footer: true,
        navLegend: true,
        pip: true,
        cameraHud: true,
        onboarding: true,
      }
    case 'visualize':
      return {
        toolbar: true,
        modeSwitcher: true,
        projectChip: true,
        outliner: false,
        addDrawer: false,
        objectBar: false,
        timeline: false,
        sequence: false,
        composeTabs: false,
        shotFrame: false,
        cameraBar: false,
        addShot: false,
        visualizeRail: false,
        directorDock: true,
        footer: false,
        navLegend: false,
        pip: false,
        cameraHud: false,
        onboarding: true,
      }
    default: {
      const _never: never = mode
      return _never
    }
  }
}

/** Gizmos, pen, and mesh drag — hidden in Visualize and play mode. */
export function isSceneEditing(playMode: boolean, workspaceMode: WorkspaceMode): boolean {
  return !playMode && workspaceMode !== 'visualize'
}

/** Path / pen editing belongs to Compose. */
export function isPathEditing(playMode: boolean, workspaceMode: WorkspaceMode): boolean {
  return !playMode && workspaceMode === 'compose'
}
