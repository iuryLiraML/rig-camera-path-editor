import type { PathAnchor } from '../state/usePathStore'
import type { Vec3 } from '../state/useSceneStore'

export type SynthesizeQuarterOrbitOptions = {
  /** Number of anchors along the arc (inclusive). Default 5. */
  count?: number
  /** Sweep in radians. Default π/2 (matches the old StageHost demo orbit). */
  arcRadians?: number
  /** Vertical bob amplitude added as sin(u·π)·amp. Default 0.6. */
  heightAmp?: number
  /** Rounding passed through to path consumers (not applied here). Default 0.8. */
  rounding?: number
}

export type SynthesizedPath = {
  anchors: PathAnchor[]
  closed: boolean
  rounding: number
  /** Look-at focus used to author the arc */
  target: Vec3
}

/**
 * Build a short open path from a cinema origin + focus so Demo (and Blank)
 * scrub through the same Bézier / channel evaluators without a drawn path.
 *
 * Matches the former StageHost quarter-orbit demo: yaw sweeps arcRadians around
 * focus in XZ; height bobs with a half-sine so streaming samples vary in height.
 */
export function synthesizeQuarterOrbitPath(
  origin: Vec3,
  focus: Vec3,
  options: SynthesizeQuarterOrbitOptions = {},
): SynthesizedPath {
  const count = Math.max(2, Math.floor(options.count ?? 5))
  const arc = options.arcRadians ?? Math.PI * 0.5
  const heightAmp = options.heightAmp ?? 0.6
  const rounding = options.rounding ?? 0.8

  const radius = Math.hypot(origin[0] - focus[0], origin[2] - focus[2]) || 12
  const baseYaw = Math.atan2(origin[0] - focus[0], origin[2] - focus[2])

  const anchors: PathAnchor[] = []
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1)
    const yaw = baseYaw + u * arc
    const y = origin[1] + Math.sin(u * Math.PI) * heightAmp
    const position: Vec3 = [
      focus[0] + Math.sin(yaw) * radius,
      y,
      focus[2] + Math.cos(yaw) * radius,
    ]
    anchors.push({
      id: `demo-orbit-${i}`,
      position,
      handleIn: [0, 0, 0],
      handleOut: [0, 0, 0],
      mirrored: true,
      manual: false,
    })
  }

  return {
    anchors,
    closed: false,
    rounding,
    target: [focus[0], focus[1], focus[2]],
  }
}
