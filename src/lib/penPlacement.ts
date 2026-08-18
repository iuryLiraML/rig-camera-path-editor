import type { Vec3 } from '../state/useSceneStore'

/** Snap the horizontal (X, Z) of a world point to a grid; Y is untouched. */
export function snapToGridXZ(p: Vec3, size: number): Vec3 {
  if (!(size > 0)) return p
  return [Math.round(p[0] / size) * size, p[1], Math.round(p[2] / size) * size]
}

/**
 * Whether snapping is active for this click. A persistent toggle can be
 * momentarily inverted while Ctrl is held (magnet on → Ctrl draws free;
 * magnet off → Ctrl snaps).
 */
export function snapActive(toggle: boolean, ctrlHeld: boolean): boolean {
  return ctrlHeld ? !toggle : toggle
}

/**
 * Height of the construction plane a pen click lands on when there is no
 * surface under the cursor: the previous anchor's height (altitude continuity
 * for aerial paths), or the ground (0) for the very first point, plus a live
 * offset the user nudges with the wheel.
 */
export function constructionHeight(lastAnchorWorldY: number | null, offset: number): number {
  return (lastAnchorWorldY ?? 0) + offset
}
