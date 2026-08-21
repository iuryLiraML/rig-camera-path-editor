import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { executeTool } from './agent/tools'
import { objectWorldBox } from './floorSnap'
import { useSceneStore } from '../state/useSceneStore'

afterEach(() => {
  useSceneStore.setState({ objects: [], pendingLifts: [] })
})

describe('floor-aware add_primitive', () => {
  it('sits a default box on the floor at the origin', async () => {
    const message = await executeTool('add_primitive', { kind: 'box' })
    const object = useSceneStore.getState().objects.at(-1)
    expect(object).toBeTruthy()
    const box = objectWorldBox(object!)
    expect(box.min.y).toBeCloseTo(0, 2)
    expect(object!.transform.position[0]).toBeCloseTo(0, 5)
    expect(object!.transform.position[2]).toBeCloseTo(0, 5)
    expect(message).toContain(object!.id)
  })

  it('snaps pose_object Y so a 1.4-tall box does not float', async () => {
    await executeTool('add_primitive', { kind: 'box' })
    const id = useSceneStore.getState().objects.at(-1)!.id
    await executeTool('pose_object', { object_id: id, position: [2, 1, -1] })
    const object = useSceneStore.getState().objects.find((item) => item.id === id)!
    expect(object.transform.position[0]).toBeCloseTo(2, 5)
    expect(object.transform.position[2]).toBeCloseTo(-1, 5)
    expect(objectWorldBox(object).min.y).toBeCloseTo(0, 2)
  })

  it('stands a wall on the floor with vertical size on Y', async () => {
    await executeTool('add_primitive', { kind: 'box', role: 'wall' })
    const object = useSceneStore.getState().objects.at(-1)!
    expect(object.name).toBe('Wall')
    const box = objectWorldBox(object)
    const extents = box.getSize(new THREE.Vector3())
    expect(extents.y).toBeGreaterThan(1.5)
    expect(extents.y).toBeGreaterThan(extents.z)
    expect(box.min.y).toBeCloseTo(0, 2)
  })

  it('places a floor plane at y=0', async () => {
    await executeTool('add_primitive', { kind: 'sphere', role: 'floor' })
    const object = useSceneStore.getState().objects.at(-1)!
    expect(object.name).toBe('Floor')
    expect(object.primitive?.kind).toBe('plane')
    expect(objectWorldBox(object).min.y).toBeCloseTo(0, 2)
  })
})
