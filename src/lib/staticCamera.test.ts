import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyCanvasAspect, applyFly, applyPoseToObject, eulerDegFromQuaternion, lookAtRotationDeg, lookPointFromPose, poseFromCamera, poseFromObject, posePlacedInView } from './staticCamera'
import type { StaticPose } from '../state/useRigStore'

const pose = (over: Partial<StaticPose> = {}): StaticPose => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  ...over,
})

describe('poseFromCamera', () => {
  it('round-trips position and orientation of a THREE camera', () => {
    const cam = new THREE.PerspectiveCamera()
    cam.position.set(1, 2, 3)
    cam.rotation.set(0.1, -0.3, 0, 'YXZ')
    cam.updateMatrixWorld(true)

    const p = poseFromCamera(cam)
    expect(p.position).toEqual([1, 2, 3])

    const back = new THREE.Euler(
      p.rotation[0] * THREE.MathUtils.DEG2RAD,
      p.rotation[1] * THREE.MathUtils.DEG2RAD,
      p.rotation[2] * THREE.MathUtils.DEG2RAD,
      'YXZ',
    )
    const q = new THREE.Quaternion().setFromEuler(back)
    expect(q.angleTo(cam.quaternion)).toBeLessThan(1e-6)
  })
})

describe('lookAtRotationDeg', () => {
  it('faces down −Z when the target is straight ahead', () => {
    const rot = lookAtRotationDeg([0, 0, 0], [0, 0, -5])
    expect(Math.abs(rot[0])).toBeLessThan(1e-4)
    expect(Math.abs(rot[1])).toBeLessThan(1e-4)
  })

  it('yaws a quarter turn toward a target on the +X axis', () => {
    const rot = lookAtRotationDeg([0, 0, 0], [5, 0, 0])
    expect(Math.abs(rot[1])).toBeCloseTo(90, 3)
  })
})

describe('applyFly', () => {
  it('holds still with no input', () => {
    const next = applyFly(pose(), {
      forward: 0,
      right: 0,
      up: 0,
      yawDelta: 0,
      pitchDelta: 0,
      speed: 4,
      dt: 0.016,
    })
    expect(next.position).toEqual([0, 0, 0])
    expect(next.rotation).toEqual([0, 0, 0])
  })

  it('walks along −Z when pressing forward from the default facing', () => {
    const next = applyFly(pose(), {
      forward: 1,
      right: 0,
      up: 0,
      yawDelta: 0,
      pitchDelta: 0,
      speed: 10,
      dt: 0.1,
    })
    expect(next.position[2]).toBeCloseTo(-1, 5)
    expect(Math.abs(next.position[0])).toBeLessThan(1e-6)
    expect(Math.abs(next.position[1])).toBeLessThan(1e-6)
  })

  it('moves vertically with the up intent regardless of facing', () => {
    const next = applyFly(pose({ rotation: [0, 45, 0] }), {
      forward: 0,
      right: 0,
      up: 1,
      yawDelta: 0,
      pitchDelta: 0,
      speed: 2,
      dt: 0.5,
    })
    expect(next.position[1]).toBeCloseTo(1, 5)
    expect(Math.abs(next.position[0])).toBeLessThan(1e-6)
    expect(Math.abs(next.position[2])).toBeLessThan(1e-6)
  })

  it('clamps pitch just short of straight up or down', () => {
    const next = applyFly(pose(), {
      forward: 0,
      right: 0,
      up: 0,
      yawDelta: 0,
      pitchDelta: -10, // huge look-up
      speed: 4,
      dt: 0.016,
    })
    expect(next.rotation[0]).toBeLessThanOrEqual(89)
    expect(next.rotation[0]).toBeGreaterThan(88)
  })

  it('keeps the horizon level (never introduces roll)', () => {
    const next = applyFly(pose({ rotation: [10, 20, 0] }), {
      forward: 1,
      right: 1,
      up: 0,
      yawDelta: 0.2,
      pitchDelta: 0.1,
      speed: 5,
      dt: 0.033,
    })
    expect(next.rotation[2]).toBe(0)
  })
})

describe('eulerDegFromQuaternion', () => {
  it('is the inverse of building a YXZ quaternion', () => {
    const e = new THREE.Euler(0.2, 0.5, 0, 'YXZ')
    const q = new THREE.Quaternion().setFromEuler(e)
    const deg = eulerDegFromQuaternion(q)
    expect(deg[0]).toBeCloseTo(0.2 * THREE.MathUtils.RAD2DEG, 3)
    expect(deg[1]).toBeCloseTo(0.5 * THREE.MathUtils.RAD2DEG, 3)
  })
})

describe('posePlacedInView', () => {
  it('sits in front of the editor camera, not on top of it', () => {
    const cam = new THREE.PerspectiveCamera()
    cam.position.set(0, 2, 8)
    cam.lookAt(0, 2, 0)
    cam.updateMatrixWorld(true)
    const p = posePlacedInView(cam, 3)
    const dist = Math.hypot(
      p.position[0] - cam.position.x,
      p.position[1] - cam.position.y,
      p.position[2] - cam.position.z,
    )
    expect(dist).toBeCloseTo(3, 2)
    expect(dist).toBeGreaterThan(1)
  })
})

describe('lookPointFromPose', () => {
  it('sits along −Z when the pose has no rotation', () => {
    const p = lookPointFromPose({ position: [1, 2, 3], rotation: [0, 0, 0] }, 5)
    expect(p[0]).toBeCloseTo(1, 5)
    expect(p[1]).toBeCloseTo(2, 5)
    expect(p[2]).toBeCloseTo(-2, 5)
  })
})

describe('poseFromObject', () => {
  it('round-trips through applyPoseToObject', () => {
    const group = new THREE.Group()
    applyPoseToObject(group, { position: [2, 3, 4], rotation: [10, -20, 5] })
    const back = poseFromObject(group)
    expect(back.position[0]).toBeCloseTo(2, 5)
    expect(back.position[1]).toBeCloseTo(3, 5)
    expect(back.position[2]).toBeCloseTo(4, 5)
    expect(back.rotation[0]).toBeCloseTo(10, 3)
    expect(back.rotation[1]).toBeCloseTo(-20, 3)
    expect(back.rotation[2]).toBeCloseTo(5, 3)
  })
})

describe('applyCanvasAspect', () => {
  it('restores a PiP-squashed camera to the canvas ratio', () => {
    const cam = new THREE.PerspectiveCamera(45, 0.3, 0.05, 200)
    const changed = applyCanvasAspect(cam, 1920, 1080)
    expect(changed).toBe(true)
    expect(cam.aspect).toBeCloseTo(1920 / 1080, 5)
  })

  it('no-ops when the aspect already matches', () => {
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 200)
    expect(applyCanvasAspect(cam, 1600, 900)).toBe(false)
  })
})
