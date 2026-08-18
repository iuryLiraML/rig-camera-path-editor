import { describe, expect, it } from 'vitest'
import { aabbFromCenterSize, projectedFillPercent } from './agent/framing'
import { fillRangeForScale } from './agent/shotTypes'
import { distanceForFill, fovForScale, instantiateAtom } from './atomPath'

const subject = aabbFromCenterSize([0, 1, 0], [1, 2, 1])
const ASPECT = 16 / 9

describe('distanceForFill', () => {
  it('lands a CU sample inside the locked fill band', () => {
    const fov = fovForScale('cu')
    const r = distanceForFill(subject, 'cu', 'eye', ASPECT, fov)
    const pos: [number, number, number] = [
      subject.center[0] + r * 0.99,
      subject.center[1] + r * Math.sin((8 * Math.PI) / 180),
      subject.center[2] + r * 0.15,
    ]
    const fill = projectedFillPercent(subject, pos, subject.center, fov, ASPECT)
    const band = fillRangeForScale('cu')
    expect(fill).toBeGreaterThanOrEqual(band.min - 4)
    expect(fill).toBeLessThanOrEqual(band.max + 4)
  })

  it('keeps a long shot farther than a close-up', () => {
    const cu = distanceForFill(subject, 'cu', 'eye', ASPECT, fovForScale('cu'))
    const ls = distanceForFill(subject, 'ls', 'eye', ASPECT, fovForScale('ls'))
    expect(ls).toBeGreaterThan(cu)
  })
})

describe('instantiateAtom', () => {
  it('builds a closed orbit whose mid-path sample hits the CU band', () => {
    const atom = instantiateAtom({ kind: 'orbit', subject, scale: 'cu', angle: 'eye', aspect: ASPECT })
    expect(atom.closed).toBe(true)
    expect(atom.anchors.length).toBe(8)
    const mid = atom.anchors[2]
    const fill = projectedFillPercent(subject, mid, atom.lookTarget, atom.fov, ASPECT)
    const band = fillRangeForScale('cu')
    expect(fill).toBeGreaterThanOrEqual(band.min)
    expect(fill).toBeLessThanOrEqual(band.max)
  })

  it('builds a dolly that stays outside the subject', () => {
    const atom = instantiateAtom({ kind: 'dolly', subject, scale: 'mcu', angle: 'eye', aspect: ASPECT })
    expect(atom.closed).toBe(false)
    expect(atom.anchors).toHaveLength(2)
    for (const p of atom.anchors) {
      const dist = Math.hypot(p[0] - subject.center[0], p[1] - subject.center[1], p[2] - subject.center[2])
      expect(dist).toBeGreaterThan(subject.diagonal * 0.4)
    }
  })

  it('raises a high-angle orbit above the subject center', () => {
    const atom = instantiateAtom({ kind: 'orbit', subject, scale: 'ms', angle: 'high', aspect: ASPECT })
    const midY = atom.anchors.reduce((s, a) => s + a[1], 0) / atom.anchors.length
    expect(midY).toBeGreaterThan(subject.center[1] + subject.size[1] * 0.15)
  })

  it('writes dutch roll and pan look keys', () => {
    const dutch = instantiateAtom({ kind: 'orbit', subject, scale: 'auto', angle: 'dutch', aspect: ASPECT })
    expect(dutch.roll).toBeGreaterThanOrEqual(8)
    const pan = instantiateAtom({ kind: 'pan', subject, scale: 'ms', angle: 'eye', aspect: ASPECT })
    expect(pan.lookKeys).toHaveLength(2)
  })
})
