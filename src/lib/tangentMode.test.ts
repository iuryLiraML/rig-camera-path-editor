import { describe, expect, it, beforeEach } from 'vitest'
import { anchorTangentMode } from './curve'
import { makeAnchor, usePathStore } from '../state/usePathStore'
import type { PathAnchor } from '../state/usePathStore'

const base = (over: Partial<PathAnchor>): PathAnchor => ({ ...makeAnchor([0, 0, 0]), ...over })

describe('anchorTangentMode', () => {
  it('non-manual anchors are auto', () => {
    expect(anchorTangentMode(base({ manual: false }))).toBe('auto')
  })

  it('manual with zero handles is a corner', () => {
    expect(anchorTangentMode(base({ manual: true, handleIn: [0, 0, 0], handleOut: [0, 0, 0] }))).toBe('corner')
  })

  it('manual mirrored is smooth, otherwise broken', () => {
    expect(anchorTangentMode(base({ manual: true, mirrored: true, handleOut: [1, 0, 0], handleIn: [-1, 0, 0] }))).toBe('smooth')
    expect(anchorTangentMode(base({ manual: true, mirrored: false, handleOut: [1, 0, 0], handleIn: [0, 0, 1] }))).toBe('broken')
  })
})

describe('setAnchorTangent', () => {
  beforeEach(() => {
    const s = usePathStore.getState()
    s.clearPath()
    s.setPath(
      [
        [0, 1, 0],
        [1, 1, 0],
        [2, 1, 0],
      ],
      false,
    )
  })

  const midId = () => usePathStore.getState().getPath(usePathStore.getState().activePathId)!.anchors[1].id
  const mid = () => usePathStore.getState().getPath(usePathStore.getState().activePathId)!.anchors[1]

  it('corner zeroes the handles and marks manual', () => {
    usePathStore.getState().setAnchorTangent(midId(), 'corner')
    expect(anchorTangentMode(mid())).toBe('corner')
    expect(mid().manual).toBe(true)
  })

  it('smooth seeds mirrored handles from the auto tangent', () => {
    usePathStore.getState().setAnchorTangent(midId(), 'smooth')
    const a = mid()
    expect(anchorTangentMode(a)).toBe('smooth')
    expect(a.mirrored).toBe(true)
    expect(a.handleIn).toEqual([-a.handleOut[0], -a.handleOut[1], -a.handleOut[2]])
    expect(a.handleOut[0]).not.toBe(0)
  })

  it('auto clears the manual flag again', () => {
    usePathStore.getState().setAnchorTangent(midId(), 'corner')
    usePathStore.getState().setAnchorTangent(midId(), 'auto')
    expect(anchorTangentMode(mid())).toBe('auto')
    expect(mid().manual).toBe(false)
  })
})
