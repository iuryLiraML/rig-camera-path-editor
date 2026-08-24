export interface DepthRange {
  near: number
  far: number
}

/** Auto-fit used by the depth pass: a window around the scene from the camera. */
export function fitDepthRange(dist: number, radius: number): DepthRange {
  return {
    near: Math.max(0.05, dist - radius * 1.6),
    far: dist + radius * 1.6,
  }
}

/** Manual sliders when auto is off; otherwise the fitted window (or the last defaults). */
export function resolveDepthRange(
  auto: boolean,
  manual: DepthRange,
  fitted: DepthRange | null,
): DepthRange {
  if (!auto) {
    const near = Math.max(0.05, manual.near)
    return { near, far: Math.max(near + 0.01, manual.far) }
  }
  return fitted ?? { near: 0.1, far: 20 }
}

export function applyDepthUniforms(
  uniforms: { uNear: { value: number }; uFar: { value: number } },
  range: DepthRange,
) {
  uniforms.uNear.value = range.near
  uniforms.uFar.value = range.far
}
