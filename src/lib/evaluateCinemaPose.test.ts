import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DEFAULT_EASE } from './easing'
import { evaluateCinemaPose, type CinemaChannels } from './evaluateCinemaPose'
import type { TrackTarget } from './objectMotion'
import { normalizeCameraNoise } from './cameraNoise'
import { synthesizeQuarterOrbitPath } from './synthesizeDemoPath'
import type { PathAnchor } from '../state/usePathStore'
import type { Vec3 } from '../state/useSceneStore'

function channels(partial: Partial<CinemaChannels> = {}): CinemaChannels {
  return {
    fov: 50,
    roll: 0,
    target: [0, 1, 0],
    ease: DEFAULT_EASE,
    lookAtMode: 'target',
    progressKeys: [],
    fovKeys: [],
    rollKeys: [],
    targetKeys: [],
    ...partial,
  }
}

function lineAnchors(a: Vec3, b: Vec3): PathAnchor[] {
  return [
    {
      id: 'a',
      position: a,
      handleIn: [0, 0, 0],
      handleOut: [0, 0, 0],
      mirrored: true,
      manual: false,
    },
    {
      id: 'b',
      position: b,
      handleIn: [0, 0, 0],
      handleOut: [0, 0, 0],
      mirrored: true,
      manual: false,
    },
  ]
}

describe('synthesizeQuarterOrbitPath', () => {
  it('emits at least two anchors and starts near the origin azimuth', () => {
    const origin: Vec3 = [10, 2, -10]
    const focus: Vec3 = [12, 3, 0]
    const path = synthesizeQuarterOrbitPath(origin, focus, { count: 5 })
    expect(path.anchors.length).toBe(5)
    expect(path.closed).toBe(false)
    expect(path.target).toEqual(focus)

    const start = path.anchors[0].position
    const dx = start[0] - focus[0]
    const dz = start[2] - focus[2]
    const originDx = origin[0] - focus[0]
    const originDz = origin[2] - focus[2]
    // Same azimuth as origin (radius may match; allow small float error)
    const cross = originDx * dz - originDz * dx
    const dot = originDx * dx + originDz * dz
    expect(Math.abs(cross)).toBeLessThan(1e-6)
    expect(dot).toBeGreaterThan(0)
  })

  it('sweeps a positive arc so endpoints are distinct', () => {
    const path = synthesizeQuarterOrbitPath([4, 1.6, 0], [0, 1, 0], { count: 4 })
    const a = path.anchors[0].position
    const b = path.anchors[path.anchors.length - 1].position
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    expect(dist).toBeGreaterThan(1)
  })
})

describe('evaluateCinemaPose', () => {
  it('returns null when fewer than two anchors', () => {
    expect(
      evaluateCinemaPose(0, { anchors: lineAnchors([0, 1, 4], [0, 1, 4]).slice(0, 1) }, channels()),
    ).toBeNull()
  })

  it('places the camera on the path endpoints at t=0 and t=1 with linear progress', () => {
    const anchors = lineAnchors([0, 1, 4], [0, 1, 0])
    const ch = channels({ ease: 'linear', target: [0, 1, -2] })
    const start = evaluateCinemaPose(0, { anchors, rounding: 0 }, ch)!
    const end = evaluateCinemaPose(1, { anchors, rounding: 0 }, ch)!
    expect(start.position[0]).toBeCloseTo(0, 5)
    expect(start.position[2]).toBeCloseTo(4, 5)
    expect(end.position[2]).toBeCloseTo(0, 5)
    expect(start.pathU).toBeCloseTo(0, 5)
    expect(end.pathU).toBeCloseTo(1, 5)
  })

  it('interpolates FOV from channel keys', () => {
    const anchors = lineAnchors([0, 1, 4], [0, 1, 0])
    const pose = evaluateCinemaPose(
      0.5,
      { anchors, rounding: 0 },
      channels({
        ease: 'linear',
        fov: 50,
        fovKeys: [
          { id: 'f0', time: 0, value: 40 },
          { id: 'f1', time: 1, value: 60 },
        ],
      }),
    )!
    expect(pose.fov).toBeCloseTo(50, 5)
  })

  it('keeps orientation continuous along a synthesized orbit (refining shrinks max step)', () => {
    const path = synthesizeQuarterOrbitPath([10.3, 2, -10], [12, 3, 0], { count: 6 })
    const ch = channels({ ease: 'linear', target: path.target, lookAtMode: 'target' })
    const input = { anchors: path.anchors, closed: path.closed, rounding: path.rounding }

    const maxStep = (steps: number) => {
      let worst = 0
      let prev = new THREE.Quaternion()
      for (let i = 0; i <= steps; i++) {
        const pose = evaluateCinemaPose(i / steps, input, ch)!
        const q = new THREE.Quaternion(...pose.quaternion)
        if (i > 0) {
          const delta = prev.angleTo(q)
          if (delta > worst) worst = delta
        }
        prev.copy(q)
      }
      return worst
    }

    const coarse = maxStep(40)
    const fine = maxStep(160)
    expect(fine).toBeLessThan(coarse * 0.55)
    expect(fine).toBeLessThan(0.2)
  })

  it('applies seeded noise the same way twice and not when disabled', () => {
    const anchors = lineAnchors([0, 1, 4], [0, 1, 0])
    const quiet = evaluateCinemaPose(0.4, { anchors, rounding: 0 }, channels())!
    const noisy = evaluateCinemaPose(
      0.4,
      { anchors, rounding: 0 },
      channels({
        noise: normalizeCameraNoise({ enabled: true, ampPos: 0.05, ampRot: 1, freq: 4, seed: 7 }),
      }),
    )!
    const again = evaluateCinemaPose(
      0.4,
      { anchors, rounding: 0 },
      channels({
        noise: normalizeCameraNoise({ enabled: true, ampPos: 0.05, ampRot: 1, freq: 4, seed: 7 }),
      }),
    )!
    expect(noisy.position).toEqual(again.position)
    expect(noisy.position).not.toEqual(quiet.position)
  })

  it('scales noise by intensity keys the same way FOV keys scale FOV', () => {
    const anchors = lineAnchors([0, 1, 4], [0, 1, 0])
    const noise = normalizeCameraNoise({
      enabled: true,
      intensity: 1,
      ampPos: 0.08,
      ampRot: 0,
      freq: 4,
      seed: 3,
    })
    const keys = [
      { id: 'i0', time: 0, value: 0 },
      { id: 'i1', time: 1, value: 1 },
    ]
    const start = evaluateCinemaPose(
      0,
      { anchors, rounding: 0 },
      channels({ ease: 'linear', noise, intensityKeys: keys }),
    )!
    const mid = evaluateCinemaPose(
      0.5,
      { anchors, rounding: 0 },
      channels({ ease: 'linear', noise, intensityKeys: keys }),
    )!
    const end = evaluateCinemaPose(
      1,
      { anchors, rounding: 0 },
      channels({ ease: 'linear', noise, intensityKeys: keys }),
    )!
    const quiet = evaluateCinemaPose(0, { anchors, rounding: 0 }, channels())!
    expect(start.position).toEqual(quiet.position)
    const midOff = Math.hypot(
      mid.position[0] - quiet.position[0],
      mid.position[1] - quiet.position[1],
      mid.position[2] - quiet.position[2],
    )
    const endOff = Math.hypot(
      end.position[0] - quiet.position[0],
      end.position[1] - quiet.position[1],
      end.position[2] - quiet.position[2],
    )
    expect(endOff).toBeGreaterThan(midOff)
    expect(midOff).toBeGreaterThan(0)
  })

  it('scales noise by ampPos keys the same way intensity keys scale amount', () => {
    const anchors = lineAnchors([0, 1, 4], [0, 1, 0])
    const noise = normalizeCameraNoise({
      enabled: true,
      intensity: 1,
      ampPos: 0.02,
      ampRot: 0,
      freq: 4,
      seed: 3,
    })
    const keys = [
      { id: 'p0', time: 0, value: 0 },
      { id: 'p1', time: 1, value: 0.16 },
    ]
    const start = evaluateCinemaPose(
      0,
      { anchors, rounding: 0 },
      channels({ ease: 'linear', noise, ampPosKeys: keys }),
    )!
    const mid = evaluateCinemaPose(
      0.5,
      { anchors, rounding: 0 },
      channels({ ease: 'linear', noise, ampPosKeys: keys }),
    )!
    const end = evaluateCinemaPose(
      1,
      { anchors, rounding: 0 },
      channels({ ease: 'linear', noise, ampPosKeys: keys }),
    )!
    const quiet = evaluateCinemaPose(0, { anchors, rounding: 0 }, channels())!
    expect(start.position).toEqual(quiet.position)
    const midOff = Math.hypot(
      mid.position[0] - quiet.position[0],
      mid.position[1] - quiet.position[1],
      mid.position[2] - quiet.position[2],
    )
    const endOff = Math.hypot(
      end.position[0] - quiet.position[0],
      end.position[1] - quiet.position[1],
      end.position[2] - quiet.position[2],
    )
    expect(endOff).toBeGreaterThan(midOff)
    expect(midOff).toBeGreaterThan(0)
  })

  it('aims toward the look-at target away from the pole', () => {
    const anchors = lineAnchors([0, 1, 5], [0, 1, 1])
    const pose = evaluateCinemaPose(
      0,
      { anchors, rounding: 0 },
      channels({ ease: 'linear', target: [0, 1, 0], lookAtMode: 'target' }),
    )!
    // Camera -Z should point roughly toward −Z (from z=5 toward origin)
    const q = new THREE.Quaternion(...pose.quaternion)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
    expect(forward.z).toBeLessThan(-0.9)
    expect(Math.abs(forward.x)).toBeLessThan(0.1)
  })

  it('aims at a tracked object as it moves', () => {
    const anchors = lineAnchors([0, 2, 6], [0, 2, 2])
    const start = evaluateCinemaPose(
      0,
      { anchors, rounding: 0 },
      channels({
        ease: 'linear',
        lookAtMode: 'target',
        track: {
          object: {
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            keys: [
              {
                id: 'k0',
                time: 0,
                transform: { position: [2, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              },
              {
                id: 'k1',
                time: 1,
                transform: { position: [-2, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              },
            ],
          },
          path: null,
        },
      }),
    )!
    const end = evaluateCinemaPose(
      1,
      { anchors, rounding: 0 },
      channels({
        ease: 'linear',
        lookAtMode: 'target',
        track: {
          object: {
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            keys: [
              {
                id: 'k0',
                time: 0,
                transform: { position: [2, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              },
              {
                id: 'k1',
                time: 1,
                transform: { position: [-2, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              },
            ],
          },
          path: null,
        },
      }),
    )!
    expect(start.lookTarget[0]).toBeCloseTo(2, 4)
    expect(end.lookTarget[0]).toBeCloseTo(-2, 4)
  })

  it('adds a local lookOffset on a tracked object, including yaw', () => {
    const parent: TrackTarget = {
      object: {
        transform: { position: [10, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1] },
        keys: [],
      },
      path: null,
    }
    const pose = evaluateCinemaPose(
      0,
      { anchors: lineAnchors([0, 2, 6], [0, 2, 2]), rounding: 0 },
      channels({
        ease: 'linear',
        lookAtMode: 'target',
        track: parent,
        lookOffset: [0, 1.5, 2],
      }),
    )!
    // yaw +90° Y: local +Z → world +X; local +Y stays +Y
    expect(pose.lookTarget[0]).toBeCloseTo(12, 3)
    expect(pose.lookTarget[1]).toBeCloseTo(1.5, 3)
    expect(pose.lookTarget[2]).toBeCloseTo(0, 3)
  })

  it('rides a parent: local path offset follows translation and yaw', () => {
    const parent: TrackTarget = {
      object: {
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        keys: [
          {
            id: 'k0',
            time: 0,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          },
          {
            id: 'k1',
            time: 1,
            transform: { position: [10, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1] },
          },
        ],
      },
      path: null,
    }
    // Local +Z offset (over-shoulder). Distinct anchors so the curve exists.
    const anchors = lineAnchors([0, 1, 2], [0, 1, 2.5])
    const start = evaluateCinemaPose(
      0,
      { anchors, rounding: 0 },
      channels({ ease: 'linear', lookAtMode: 'target', track: parent, pathParent: parent }),
    )!
    const end = evaluateCinemaPose(
      1,
      { anchors, rounding: 0 },
      channels({ ease: 'linear', lookAtMode: 'target', track: parent, pathParent: parent }),
    )!
    expect(start.position[0]).toBeCloseTo(0, 4)
    expect(start.position[2]).toBeCloseTo(2, 4)
    // Parent at +X, yaw +90° Y: local +Z becomes world +X
    expect(end.position[0]).toBeCloseTo(12.5, 3)
    expect(end.position[2]).toBeCloseTo(0, 3)
    expect(end.lookTarget[0]).toBeCloseTo(10, 4)
  })
})

describe('evaluateStaticPose', () => {
  it('aims at the look-at point and ignores Euler when Target is on', () => {
    const staticPose = { position: [0, 1, 5] as Vec3, rotation: [80, 40, 0] as Vec3 }
    const pose = evaluateCinemaPose(
      0,
      { anchors: [] },
      channels({
        cameraKind: 'static',
        lookAtMode: 'target',
        staticPose,
        target: [0, 1, 0],
      }),
    )!
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...pose.quaternion))
    expect(forward.z).toBeLessThan(-0.9)
    expect(Math.abs(forward.x)).toBeLessThan(0.1)
    expect(Math.abs(forward.y)).toBeLessThan(0.1)
  })

  it('uses the stored Euler in Free', () => {
    const aimed = evaluateCinemaPose(
      0,
      { anchors: [] },
      channels({
        cameraKind: 'static',
        lookAtMode: 'target',
        staticPose: { position: [0, 1, 5], rotation: [80, 40, 0] },
        target: [0, 1, 0],
      }),
    )!
    const free = evaluateCinemaPose(
      0,
      { anchors: [] },
      channels({
        cameraKind: 'static',
        lookAtMode: 'free',
        staticPose: { position: [0, 1, 5], rotation: [80, 40, 0] },
        target: [0, 1, 0],
      }),
    )!
    expect(free.quaternion).not.toEqual(aimed.quaternion)
    expect(free.position).toEqual([0, 1, 5])
  })

  it('interpolates keyed position as a pure function of t', () => {
    const pose = evaluateCinemaPose(
      0.5,
      { anchors: [] },
      channels({
        ease: 'linear',
        cameraKind: 'static',
        lookAtMode: 'free',
        staticPose: { position: [0, 0, 0], rotation: [0, 0, 0] },
        staticPosKeys: [
          { id: 'p0', time: 0, value: [0, 1, 0] },
          { id: 'p1', time: 1, value: [4, 1, 0] },
        ],
      }),
    )!
    expect(pose.position[0]).toBeCloseTo(2, 5)
    expect(pose.position[1]).toBeCloseTo(1, 5)
    expect(pose.position[2]).toBeCloseTo(0, 5)
  })

  it('interpolates keyed rotation in Free', () => {
    const start = evaluateCinemaPose(
      0,
      { anchors: [] },
      channels({
        ease: 'linear',
        cameraKind: 'static',
        lookAtMode: 'free',
        staticPose: { position: [0, 1, 5], rotation: [0, 0, 0] },
        staticRotKeys: [
          { id: 'r0', time: 0, value: [0, 0, 0] },
          { id: 'r1', time: 1, value: [0, 90, 0] },
        ],
      }),
    )!
    const mid = evaluateCinemaPose(
      0.5,
      { anchors: [] },
      channels({
        ease: 'linear',
        cameraKind: 'static',
        lookAtMode: 'free',
        staticPose: { position: [0, 1, 5], rotation: [0, 0, 0] },
        staticRotKeys: [
          { id: 'r0', time: 0, value: [0, 0, 0] },
          { id: 'r1', time: 1, value: [0, 90, 0] },
        ],
      }),
    )!
    expect(start.quaternion).not.toEqual(mid.quaternion)
  })
})
