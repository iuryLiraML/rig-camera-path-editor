import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { aimObject, orientationTo, POLE_BAND_DEG } from './cameraOrientation'

/**
 * The bug this guards: on the Flyover preset the camera passes directly over the
 * look-at target, the view direction becomes parallel to world up, and
 * lookAt's `right = up × z` degenerates. Measured in the browser, the quaternion
 * changed by exactly 180 degrees between two consecutive frames.
 */

const target = new THREE.Vector3(0, 1, 0)

/**
 * What the old code did. It must be a camera, not a plain Object3D: Object3D
 * aims its +Z at the target while a camera aims -Z, so comparing against a plain
 * object would be a guaranteed 180 degrees apart for reasons unrelated to this
 * bug.
 */
function naiveLookAt(position: THREE.Vector3, out: THREE.Quaternion) {
  const cam = new THREE.PerspectiveCamera()
  cam.up.set(0, 1, 0)
  cam.position.copy(position)
  cam.lookAt(target)
  return out.copy(cam.quaternion)
}

/** a flyover: an arc in the x/y plane passing straight over the target */
function flyover(t: number) {
  const angle = Math.PI * (t - 0.5) // -90deg .. +90deg, 0 = directly overhead
  const radius = 6
  return new THREE.Vector3(
    Math.sin(angle) * radius,
    target.y + Math.cos(angle) * radius,
    0,
  )
}

/** the tangent of that arc — horizontal at the top, which is what saves us */
function flyoverTangent(t: number) {
  const a = flyover(Math.max(0, t - 0.001))
  const b = flyover(Math.min(1, t + 0.001))
  return b.sub(a).normalize()
}

function sweep(
  orient: (t: number, out: THREE.Quaternion) => void,
  steps = 400,
): { maxDelta: number; atT: number } {
  const q = new THREE.Quaternion()
  const prev = new THREE.Quaternion()
  let maxDelta = 0
  let atT = 0
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    orient(t, q)
    if (i > 0) {
      const delta = THREE.MathUtils.radToDeg(prev.angleTo(q))
      if (delta > maxDelta) {
        maxDelta = delta
        atT = t
      }
    }
    prev.copy(q)
  }
  return { maxDelta, atT }
}

const dirTo = (position: THREE.Vector3) => target.clone().sub(position)

describe('orientationTo', () => {
  it('reproduces the flip with the old world-up lookAt (the bug)', () => {
    const { maxDelta } = sweep((t, out) => naiveLookAt(flyover(t), out))
    // this is what the user saw: a single-frame 180 degree roll over the pole
    expect(maxDelta).toBeGreaterThan(90)
  })

  it('stays continuous across the pole', () => {
    const { maxDelta, atT } = sweep((t, out) =>
      orientationTo(dirTo(flyover(t)), flyoverTangent(t), out),
    )
    // a snap is 180 degrees in one step; this is the roll being paid out
    expect(maxDelta, `worst step at t=${atT}`).toBeLessThan(20)
  })

  it('is continuous in the strict sense: refining the sampling shrinks the step', () => {
    // The real test. For a continuous function, sampling 4x finer makes the
    // largest step between samples ~4x smaller. Across a discontinuity it does
    // not shrink at all, however fine you sample — which is exactly what the old
    // lookAt does, and what makes this more than a threshold that happens to pass.
    const fixed = (steps: number) =>
      sweep((t, out) => orientationTo(dirTo(flyover(t)), flyoverTangent(t), out), steps).maxDelta
    const naive = (steps: number) => sweep((t, out) => naiveLookAt(flyover(t), out), steps).maxDelta

    expect(fixed(1600)).toBeLessThan(fixed(400) * 0.45)
    expect(fixed(6400)).toBeLessThan(fixed(1600) * 0.45)
    // the old behaviour is stuck at the full flip no matter the resolution
    expect(naive(6400)).toBeGreaterThan(naive(400) * 0.9)
    expect(naive(6400)).toBeGreaterThan(90)
  })

  it('matches lookAt exactly away from the pole', () => {
    const naive = new THREE.Quaternion()
    const fixed = new THREE.Quaternion()
    // horizontal-ish directions: well outside the handover band
    for (const t of [0.05, 0.2, 0.3, 0.7, 0.8, 0.95]) {
      const position = flyover(t)
      const alignment = Math.abs(dirTo(position).normalize().dot(new THREE.Vector3(0, 1, 0)))
      if (alignment > Math.cos(THREE.MathUtils.degToRad(POLE_BAND_DEG))) continue
      naiveLookAt(position, naive)
      orientationTo(dirTo(position), flyoverTangent(t), fixed)
      expect(THREE.MathUtils.radToDeg(naive.angleTo(fixed)), `t=${t}`).toBeLessThan(1e-4)
    }
  })

  it('returns a usable rotation looking exactly along the pole', () => {
    const out = new THREE.Quaternion()
    for (const dir of [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)]) {
      orientationTo(dir, new THREE.Vector3(1, 0, 0), out)
      expect(Number.isFinite(out.x + out.y + out.z + out.w)).toBe(true)
      expect(out.length()).toBeCloseTo(1, 6)
      // and it really is looking that way
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(out)
      expect(forward.dot(dir.clone().normalize())).toBeCloseTo(1, 5)
    }
  })

  it('survives a degenerate secondary reference', () => {
    const out = new THREE.Quaternion()
    // looking straight down with a tangent that also points straight down
    orientationTo(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0), out)
    expect(out.length()).toBeCloseTo(1, 6)
    // and with no secondary at all
    orientationTo(new THREE.Vector3(0, -1, 0), null, out)
    expect(out.length()).toBeCloseTo(1, 6)
  })

  it('aims a mesh the same way Object3D.lookAt does', () => {
    // a mesh points +Z at its target while a camera points -Z; getting this
    // backwards would send a path-following car down the road in reverse
    for (const dir of [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0.4, -0.2, 0.9),
      new THREE.Vector3(-0.7, 0.3, -0.6),
    ]) {
      const mine = new THREE.Object3D()
      aimObject(mine, dir, null, 0, 'object')

      const theirs = new THREE.Object3D()
      theirs.up.set(0, 1, 0)
      theirs.lookAt(dir.clone().normalize())

      expect(
        THREE.MathUtils.radToDeg(mine.quaternion.angleTo(theirs.quaternion)),
        dir.toArray().join(','),
      ).toBeLessThan(1e-4)
    }
  })

  it('keeps a straight vertical dive continuous', () => {
    // no preferred roll exists here, only continuity matters
    const { maxDelta } = sweep((t, out) => {
      const position = new THREE.Vector3(0, 8 - t * 6, 0)
      orientationTo(dirTo(position), new THREE.Vector3(0, -1, 0), out)
    }, 200)
    expect(maxDelta).toBeLessThan(5)
  })
})
