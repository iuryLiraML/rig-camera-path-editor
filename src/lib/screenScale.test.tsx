// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import * as THREE from 'three'

/**
 * The hook cached the last scale it applied in a ref of its own while writing
 * the scale onto the mesh. Every gizmo here mounts conditionally — the look-at
 * target unmounts in depth/outline/normals, in play mode and when the look-at
 * mode changes; path anchors unmount per anchor — so a fresh mesh would arrive
 * with scale 1 while the hook still held the old value, the diff check skipped
 * the write, and the gizmo stayed at its raw geometry size. The look-at target
 * is a radius-1 sphere, so it filled the viewport.
 */
let frameCallback: ((state: { camera: THREE.Camera }) => void) | null = null
vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: { camera: THREE.Camera }) => void) => {
    frameCallback = cb
  },
}))

const { useScreenScale } = await import('./screenScale')

/** mount the hook for real, and return a way to drive its frame callback */
function mount(ref: { current: THREE.Object3D | null }, size: number) {
  renderHook(() => useScreenScale(ref, size))
  const tick = frameCallback!
  return (camera: THREE.Camera) => tick({ camera })
}

function perspectiveAt(z: number) {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  cam.position.set(0, 0, z)
  return cam
}

describe('useScreenScale', () => {
  it('scales for a constant apparent size', () => {
    const mesh = new THREE.Mesh()
    const ref = { current: mesh as THREE.Object3D | null }
    const tick = mount(ref, 0.09)
    tick(perspectiveAt(7))
    expect(mesh.scale.x).toBeCloseTo(0.09, 5)
    tick(perspectiveAt(14))
    expect(mesh.scale.x).toBeCloseTo(0.18, 5)
  })

  it('scales a mesh that remounted while the camera stood still', () => {
    const camera = perspectiveAt(7)
    const first = new THREE.Mesh()
    const ref = { current: first as THREE.Object3D | null }
    const tick = mount(ref, 0.09)
    tick(camera)
    expect(first.scale.x).toBeCloseTo(0.09, 5)

    // the mesh unmounts and comes back: same hook, same camera, brand new mesh
    const remounted = new THREE.Mesh()
    ref.current = remounted
    tick(camera)
    // this is the bug: the cached value matched, so nothing was written and the
    // radius-1 sphere stayed at scale 1
    expect(remounted.scale.x).toBeCloseTo(0.09, 5)
    expect(remounted.scale.x).not.toBe(1)
  })

  it('keeps the ortho branch tied to zoom', () => {
    const mesh = new THREE.Mesh()
    const ref = { current: mesh as THREE.Object3D | null }
    const tick = mount(ref, 0.09)
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10)
    cam.zoom = 110
    tick(cam)
    expect(mesh.scale.x).toBeCloseTo(0.09, 5)
  })

  it('clamps so a gizmo never balloons up close or off in the distance', () => {
    const mesh = new THREE.Mesh()
    const ref = { current: mesh as THREE.Object3D | null }
    const tick = mount(ref, 0.09)
    tick(perspectiveAt(0.001))
    expect(mesh.scale.x).toBeCloseTo(0.09 * 0.02, 5)
    tick(perspectiveAt(1000))
    expect(mesh.scale.x).toBeCloseTo(0.09 * 5, 5)
  })
})

const { RING_SCREEN_SCALE } = await import('../viewport/rig/RingHandle')

describe('static rig ring scale', () => {
  it('stays in the path-anchor family at editor distance, not 0.58', () => {
    const mesh = new THREE.Mesh()
    const ref = { current: mesh as THREE.Object3D | null }
    const tick = mount(ref, RING_SCREEN_SCALE)
    tick(perspectiveAt(7))
    expect(mesh.scale.x).toBeCloseTo(0.12, 5)
    expect(mesh.scale.x).not.toBeCloseTo(0.58, 2)
  })
})
