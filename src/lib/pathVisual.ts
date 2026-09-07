/** Viewport stroke colors for motion paths. View state, not an animation channel. */

import type { WorkspaceMode } from '../state/useEditorStore'

export const PATH_FOLLOWED = '#3b82f6'
export const PATH_INACTIVE = '#8a8a8e'
export const PATH_SELECTED_HALO = '#ffffff'

export function pathLineAppearance(followed: boolean, selected: boolean) {
  return {
    color: followed ? PATH_FOLLOWED : PATH_INACTIVE,
    halo: selected,
    haloColor: PATH_SELECTED_HALO,
    lineWidth: selected ? (followed ? 2.75 : 2.5) : followed ? 2 : 1.5,
    opacity: selected ? 0.95 : followed ? 1 : 0.7,
  }
}

export function pathOverlay(input: {
  playMode: boolean
  workspaceMode: WorkspaceMode
  hidden: boolean
  tech: boolean
  anchorCount: number
  followed: boolean
  selected: boolean
}) {
  const sceneEditing = !input.playMode && input.workspaceMode !== 'visualize'
  return {
    stroke: sceneEditing && !input.hidden && !input.tech && input.anchorCount >= 2,
    editChrome:
      !input.playMode &&
      input.workspaceMode === 'compose' &&
      !input.hidden &&
      !input.tech &&
      input.anchorCount >= 1,
    appearance: pathLineAppearance(input.followed, input.selected),
  }
}
