import { isPhoneTier, type LayoutTier } from './chromeLayout'
import type { ComposeDock, Tool, WorkspaceMode } from '../state/useEditorStore'

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
  /** Phone shell: top app bar + bottom task bar + single Task sheet (#66). */
  phoneShell: boolean
}

const NO_CHROME: EditorChromeFlags = {
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
  phoneShell: false,
}

export function editorChrome(input: {
  playMode: boolean
  workspaceMode: WorkspaceMode
  composeDock: ComposeDock
  showOutliner: boolean
  showAddDrawer: boolean
  /** Defaults to a docked desktop tier when omitted, preserving old callers. */
  tier?: LayoutTier
}): EditorChromeFlags {
  if (input.playMode) {
    return { ...NO_CHROME }
  }

  // Phone shell replaces every persistent docked rail with a single Task sheet,
  // launched from the bottom task bar, over a full-bleed canvas.
  if (input.tier && isPhoneTier(input.tier)) {
    return { ...NO_CHROME, phoneShell: true }
  }

  const mode = input.workspaceMode
  switch (mode) {
    case 'build':
      return {
        toolbar: true,
        modeSwitcher: true,
        projectChip: true,
        outliner: input.showOutliner,
        // Build's object tray stays open — Compose / Visualize are Director chat.
        addDrawer: true,
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
        phoneShell: false,
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
        timeline: true,
        sequence: true,
        composeTabs: false,
        shotFrame: false,
        cameraBar: true,
        addShot: false,
        visualizeRail: false,
        directorDock: true,
        footer: true,
        navLegend: false,
        pip: true,
        cameraHud: true,
        onboarding: true,
        phoneShell: false,
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
        visualizeRail: true,
        directorDock: true,
        footer: false,
        navLegend: false,
        pip: false,
        cameraHud: false,
        onboarding: false,
        phoneShell: false,
      }
    default: {
      const _never: never = mode
      return _never
    }
  }
}

/**
 * Full-bleed cinema take: play mode, Compose look-through, or the Visualize
 * review workspace. Does not set `playMode` or `cameraView` — Visualize binds
 * the same camera without hiding the Director or enabling the fly HUD.
 */
export function isCinemaViewport(
  playMode: boolean,
  cameraView: boolean,
  workspaceMode: WorkspaceMode,
): boolean {
  return playMode || cameraView || workspaceMode === 'visualize'
}

/** Gizmos, pen, and mesh drag — hidden in Visualize and play mode. */
export function isSceneEditing(playMode: boolean, workspaceMode: WorkspaceMode): boolean {
  return !playMode && workspaceMode !== 'visualize'
}

/** Path / pen editing belongs to Compose. */
export function isPathEditing(playMode: boolean, workspaceMode: WorkspaceMode): boolean {
  return !playMode && workspaceMode === 'compose'
}

/** Pen click-to-place and Draw stroke — both steal LMB from orbit. */
export function isPathStrokeTool(tool: Tool): boolean {
  return tool === 'pen' || tool === 'draw'
}

/** Bezier guides — hidden for Free (pathless) cameras in Compose so the viewport stays uncluttered. */
export function pathGuidesVisible(
  playMode: boolean,
  workspaceMode: WorkspaceMode,
  cameraKind: 'path' | 'static',
): boolean {
  if (!isSceneEditing(playMode, workspaceMode)) return false
  if (workspaceMode === 'compose' && cameraKind === 'static') return false
  return true
}
