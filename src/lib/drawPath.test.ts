import { afterEach, describe, expect, it } from 'vitest'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import { useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { resetHistory, undo } from './history'
import { useEditorStore } from '../state/useEditorStore'
import {
  commitDrawPath,
  defaultDrawHeight,
  DRAW_PATH_ROUNDING,
  finalizeDrawStroke,
  MAX_DRAW_ANCHORS,
  resampleArcLength,
  shouldCloseLoop,
  shouldHandleDrawInput,
  smoothPolyline,
  strokeTooShort,
} from './drawPath'
import type { Vec3 } from '../state/useSceneStore'

function resetStores() {
  usePathStore.setState({
    paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
  })
  useRigStore.setState({
    cameraPathId: CAMERA_PATH_ID,
    cameraKind: 'path',
    staticPose: { position: [0, 2.25, 6], rotation: [0, 0, 0] },
  })
}

afterEach(() => {
  resetStores()
  resetHistory()
})

function line(from: Vec3, to: Vec3, steps: number): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    out.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t])
  }
  return out
}

describe('smoothPolyline', () => {
  it('pins the ends and pulls a spike toward the chord', () => {
    const out = smoothPolyline(
      [
        [0, 1, 0],
        [1, 1, 2],
        [2, 1, 0],
      ],
      6,
      0.55,
    )
    expect(out[0]).toEqual([0, 1, 0])
    expect(out[out.length - 1]).toEqual([2, 1, 0])
    expect(Math.abs(out[1][2])).toBeLessThan(1.2)
  })
})

describe('resampleArcLength', () => {
  it('places anchors one grid cell apart along the stroke', () => {
    const samples = resampleArcLength(line([0, 1, 0], [4, 1, 0], 40), 1)
    expect(samples).toHaveLength(5)
    expect(samples[0]).toEqual([0, 1, 0])
    expect(samples[samples.length - 1][0]).toBeCloseTo(4)
    expect(samples[2][0]).toBeCloseTo(2)
  })

  it('caps a long stroke at 64 anchors and still keeps the end', () => {
    const samples = resampleArcLength(line([0, 1, 0], [100, 1, 0], 200), 0.5)
    expect(samples.length).toBe(MAX_DRAW_ANCHORS)
    expect(samples[0][0]).toBeCloseTo(0)
    expect(samples[samples.length - 1][0]).toBeCloseTo(100)
  })
})

describe('finalizeDrawStroke', () => {
  it('refuses a drag shorter than one grid cell', () => {
    expect(strokeTooShort([[0, 1, 0], [0.2, 1, 0.1]], 0.5)).toBe(true)
    expect(finalizeDrawStroke([[0, 1, 0], [0.2, 1, 0.1]], 0.5)).toBeNull()
  })

  it('closes the loop when the end is within one cell of the start', () => {
    const square: Vec3[] = [
      [0, 1, 0],
      [2, 1, 0],
      [2, 1, 2],
      [0, 1, 2],
      [0.1, 1, 0.1],
    ]
    expect(shouldCloseLoop(square, 0.5)).toBe(true)
    const result = finalizeDrawStroke(square, 0.5)
    expect(result).not.toBeNull()
    expect(result!.closed).toBe(true)
    expect(result!.positions.length).toBeGreaterThanOrEqual(3)
    const last = result!.positions[result!.positions.length - 1]
    expect(Math.hypot(last[0] - result!.positions[0][0], last[2] - result!.positions[0][2])).toBeGreaterThan(0.4)
  })

  it('keeps a diagonal off the grid instead of stair-stepping', () => {
    const result = finalizeDrawStroke(line([0.3, 1, 0.2], [2.4, 1, 1.7], 24), 1)
    expect(result).not.toBeNull()
    const offGrid = result!.positions.some(
      (p) => Math.abs(p[0] - Math.round(p[0])) > 0.05 || Math.abs(p[2] - Math.round(p[2])) > 0.05,
    )
    expect(offGrid).toBe(true)
  })

  it('keeps an open path when the end is farther than one cell', () => {
    const result = finalizeDrawStroke(line([0, 1, 0], [3, 1, 0], 20), 0.5)
    expect(result?.closed).toBe(false)
    expect(result?.positions.length).toBeGreaterThanOrEqual(2)
  })

  it('damps hand jitter so a noisy line does not keep the wobble', () => {
    const noisy: Vec3[] = []
    for (let i = 0; i <= 40; i++) {
      noisy.push([i * 0.2, 1, i % 2 === 0 ? 0.28 : -0.28])
    }
    const rawAmp = Math.max(...noisy.map((p) => Math.abs(p[2])))
    const result = finalizeDrawStroke(noisy, 0.5)
    expect(result).not.toBeNull()
    const amp = Math.max(...result!.positions.map((p) => Math.abs(p[2])))
    expect(rawAmp).toBeGreaterThan(0.25)
    expect(amp).toBeLessThan(0.12)
  })

  it('keeps a C-shaped gesture instead of flattening it to a line', () => {
    const arc: Vec3[] = []
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI * (i / 24)
      arc.push([2 * Math.cos(a), 1, 2 * Math.sin(a)])
    }
    const result = finalizeDrawStroke(arc, 0.5)
    expect(result).not.toBeNull()
    const bulge = Math.max(...result!.positions.map((p) => p[2]))
    expect(bulge).toBeGreaterThan(1.1)
  })

  it('does not emit a 2-anchor closed loop from an out-and-back', () => {
    const result = finalizeDrawStroke(
      [
        [0, 1, 0],
        [0.5, 1, 0],
        [0, 1, 0],
      ],
      0.5,
    )
    expect(result).not.toBeNull()
    expect(result!.closed).toBe(false)
    expect(result!.positions.length).toBeGreaterThanOrEqual(2)
  })
})

describe('commitDrawPath', () => {
  it('creates a new path, follows it, and switches a Free camera to On path', () => {
    resetStores()
    useRigStore.setState({ cameraKind: 'static' })
    const id = commitDrawPath(
      [
        [0, 1, 0],
        [2, 1, 0],
        [4, 1, 0],
      ],
      false,
    )
    expect(id).toBeTruthy()
    expect(id).not.toBe(CAMERA_PATH_ID)
    const path = usePathStore.getState().getPath(id!)
    expect(path?.anchors).toHaveLength(3)
    expect(path?.rounding).toBe(DRAW_PATH_ROUNDING)
    expect(usePathStore.getState().activePathId).toBe(id)
    expect(useRigStore.getState().cameraPathId).toBe(id)
    expect(useRigStore.getState().cameraKind).toBe('path')
    expect(useCameraOptionsStore.getState().options[0].rig.pathId).toBe(id)
  })

  it('puts the new path in world space when the previous follow was object-parented', () => {
    resetStores()
    useRigStore.setState({ pathSpace: 'object', targetObjectId: 'obj-1' })
    commitDrawPath(
      [
        [0, 1, 0],
        [2, 1, 0],
      ],
      false,
    )
    expect(useRigStore.getState().pathSpace).toBe('world')
    expect(useCameraOptionsStore.getState().options[0].rig.pathSpace).toBe('world')
  })

  it('undo restores the previous follow and Free / On path kind', () => {
    resetStores()
    useRigStore.setState({ cameraPathId: CAMERA_PATH_ID, cameraKind: 'static' })
    resetHistory()
    const id = commitDrawPath(
      [
        [0, 1, 0],
        [3, 1, 0],
      ],
      false,
    )
    expect(usePathStore.getState().paths.some((p) => p.id === id)).toBe(true)
    expect(undo()).toBe(true)
    expect(usePathStore.getState().paths.some((p) => p.id === id)).toBe(false)
    expect(useRigStore.getState().cameraPathId).toBe(CAMERA_PATH_ID)
    expect(useRigStore.getState().cameraKind).toBe('static')
  })
})

describe('shouldHandleDrawInput', () => {
  it('is silent in look-through so fly keeps LMB and wheel', () => {
    useEditorStore.setState({ cameraView: false, playMode: false, workspaceMode: 'compose' })
    expect(shouldHandleDrawInput()).toBe(true)
    useEditorStore.setState({ cameraView: true })
    expect(shouldHandleDrawInput()).toBe(false)
    useEditorStore.setState({ cameraView: false, playMode: true })
    expect(shouldHandleDrawInput()).toBe(false)
  })
})

describe('defaultDrawHeight', () => {
  it('uses the Free camera height', () => {
    resetStores()
    useRigStore.setState({ cameraKind: 'static' })
    expect(defaultDrawHeight()).toBeCloseTo(2.25)
  })

  it('uses a usable aerial default for On path', () => {
    resetStores()
    expect(defaultDrawHeight()).toBeCloseTo(1.5)
  })
})
