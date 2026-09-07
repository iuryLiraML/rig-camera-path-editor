import * as THREE from 'three'
import { TransformControls } from 'three-stdlib'
import { describe, expect, it, beforeEach } from 'vitest'
import {
  beginPickClick,
  filterViewportHits,
  hasInteractivePick,
  penStrokeIntent,
  pickKindOf,
  preferTaggedHits,
  resetPickCycle,
  selectPointerIntent,
  setPickPointer,
  tagHits,
} from './viewportPick'

function hit(kind: string, id: string, distance: number) {
  const object = new THREE.Object3D()
  object.userData.pickKind = kind
  object.userData.pickId = id
  return { object, distance }
}

describe('viewportPick', () => {
  beforeEach(() => resetPickCycle())

  it('reads pickKind from an ancestor, including TransformControls', () => {
    const root = new THREE.Object3D()
    root.name = 'TransformControlsGizmo'
    const child = new THREE.Mesh()
    root.add(child)
    expect(pickKindOf(child)).toBe('gizmo')
  })

  it('drops the transform plane so a mesh click next to the gizmo stays a mesh', () => {
    const plane = new THREE.Object3D()
    plane.name = 'TransformControlsPlane'
    expect(pickKindOf(plane)).toBeNull()

    const tagged = tagHits([
      { object: plane, distance: 1 },
      hit('object', 'obj:box', 1.01),
      hit('camera', 'cinema-camera', 2.5),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered[0]?.id).toBe('obj:box')
    expect(ordered[0]?.kind).toBe('object')
  })

  it('keeps the W/E/R arrows even when a mesh or camera sits closer on the ray', () => {
    const root = new THREE.Object3D()
    root.name = 'TransformControlsGizmo'
    const child = new THREE.Mesh()
    root.add(child)
    const tagged = tagHits([
      { object: child, distance: 1.4 },
      hit('object', 'obj:box', 1),
      hit('camera', 'cinema-camera', 1.1),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered).toHaveLength(1)
    expect(ordered[0]?.kind).toBe('gizmo')
  })

  it('picks the look-at handle even when a mesh sits closer on the same ray', () => {
    const tagged = tagHits([
      hit('object', 'obj:knot', 1),
      hit('target', 'look-at', 2.4),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered).toHaveLength(1)
    expect(ordered[0]?.id).toBe('look-at')
  })

  it('still picks a mesh when the look-at handle is not on the ray', () => {
    const tagged = tagHits([hit('object', 'obj:knot', 1)])
    expect(preferTaggedHits(tagged)[0]?.id).toBe('obj:knot')
  })

  it('prefers a scene object over a fat path line at the same depth', () => {
    const tagged = tagHits([
      hit('path-line', 'path:a', 1),
      hit('object', 'obj:box', 1.02),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered[0]?.id).toBe('obj:box')
    expect(ordered[0]?.kind).toBe('object')
  })

  it('selects a cube in front of the camera icon, not the camera', () => {
    const tagged = tagHits([
      hit('object', 'obj:box', 1),
      hit('camera', 'cinema-camera', 1.12),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered[0]?.id).toBe('obj:box')
    expect(ordered[0]?.kind).toBe('object')
  })

  it('selects the camera when it is clearly closer than the mesh', () => {
    const tagged = tagHits([
      hit('camera', 'cinema-camera', 1),
      hit('object', 'obj:box', 2.2),
    ])
    expect(preferTaggedHits(tagged)[0]?.id).toBe('cinema-camera')
  })

  it('cycles stacked objects only on repeated clicks, not hover', () => {
    const stacked = [hit('object', 'obj:a', 1), hit('object', 'obj:b', 1.01)]

    setPickPointer(10, 10)
    expect(preferTaggedHits(tagHits(stacked))[0]?.id).toBe('obj:a')

    beginPickClick(10, 10)
    expect(preferTaggedHits(tagHits(stacked))[0]?.id).toBe('obj:a')

    setPickPointer(10, 12)
    expect(preferTaggedHits(tagHits(stacked))[0]?.id).toBe('obj:a')

    beginPickClick(11, 11)
    expect(preferTaggedHits(tagHits(stacked))[0]?.id).toBe('obj:b')

    beginPickClick(12, 10)
    expect(preferTaggedHits(tagHits(stacked))[0]?.id).toBe('obj:a')
  })

  it('lets clay objects win over the palco even when the env box is closer', () => {
    const tagged = tagHits([
      hit('env', 'env', 0.5),
      hit('object', 'obj:box', 2),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered[0]?.id).toBe('obj:box')
    expect(ordered.some((item) => item.kind === 'env')).toBe(false)
  })

  it('selects the palco when nothing else interactive is on the ray', () => {
    const tagged = tagHits([hit('env', 'env', 1)])
    expect(preferTaggedHits(tagged)[0]?.kind).toBe('env')
  })

  it('selects a path line instead of the palco when both are on the ray', () => {
    const tagged = tagHits([hit('env', 'env', 1), hit('path-line', 'path:a', 1.02)])
    expect(preferTaggedHits(tagged)[0]?.kind).toBe('path-line')
    expect(preferTaggedHits(tagged)[0]?.id).toBe('path:a')
  })

  it('does not treat a lone spline hit as an orbit lock', () => {
    expect(hasInteractivePick([hit('path-line', 'path:a', 1)])).toBe(false)
    expect(hasInteractivePick([hit('object', 'obj:a', 1)])).toBe(true)
    expect(hasInteractivePick([hit('env', 'env', 1)])).toBe(true)
    expect(hasInteractivePick([hit('env', 'env', 1)], { orbitThroughEnv: true })).toBe(false)
    expect(hasInteractivePick([hit('gizmo', 'gizmo', 0.5), hit('env', 'env', 1)], { orbitThroughEnv: true })).toBe(
      true,
    )
  })

  it('lets R3F receive a path-line hit instead of the palco', () => {
    const line = hit('path-line', 'path:a', 1.02)
    const env = hit('env', 'env', 1)
    const filtered = filterViewportHits([env, line])
    expect(filtered[0]?.object).toBe(line.object)
  })

  it('drops unmarked helpers from the R3F hit list', () => {
    const helper = new THREE.Object3D()
    const object = new THREE.Object3D()
    object.userData.pickKind = 'object'
    object.userData.pickId = 'obj:keep'
    const filtered = filterViewportHits([
      { object: helper, distance: 0.5 },
      { object, distance: 1 },
    ])
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.object).toBe(object)
  })

  it('ranks a Pen stroke as place, insert, or ignore from one pick decision', () => {
    const plane = new THREE.Object3D()
    expect(penStrokeIntent([{ object: plane, distance: 1 }])).toEqual({ action: 'place' })
    expect(penStrokeIntent([hit('object', 'obj:box', 1), hit('path-line', 'path:a', 1.1)])).toEqual({
      action: 'place',
    })
    expect(penStrokeIntent([hit('path-anchor', 'anchor:a', 0.4), hit('object', 'obj:box', 1)])).toEqual(
      { action: 'ignore' },
    )
    expect(penStrokeIntent([hit('object', 'obj:box', 1), hit('path-anchor', 'anchor:a', 8)])).toEqual({
      action: 'place',
    })
    const line = hit('path-line', 'path:a', 1.2)
    expect(penStrokeIntent([line])).toEqual({ action: 'insert', hit: line })
    expect(penStrokeIntent([hit('object', 'obj:box', 1), line])).toEqual({ action: 'place' })
    expect(penStrokeIntent([line, hit('object', 'obj:box', 1.4)])).toEqual({ action: 'insert', hit: line })
  })

  it('turns a lone path-line hit into select-path', () => {
    expect(selectPointerIntent([hit('path-line', 'path:a', 1)])).toEqual({
      action: 'select-path',
      id: 'path:a',
    })
  })

  it('keeps a closer mesh as select-object over a path line', () => {
    expect(
      selectPointerIntent([hit('object', 'obj:box', 0.4), hit('path-line', 'path:a', 1.2)]),
    ).toEqual({ action: 'select-object', id: 'obj:box' })
    expect(
      selectPointerIntent([hit('path-line', 'path:a', 1), hit('object', 'obj:box', 1.02)]),
    ).toEqual({ action: 'select-object', id: 'obj:box' })
  })

  it('does not let env consume a path line the artist clicked', () => {
    expect(selectPointerIntent([hit('env', 'env', 1), hit('path-line', 'path:a', 1.02)])).toEqual({
      action: 'select-path',
      id: 'path:a',
    })
  })
})


describe('real transform control hit regions', () => {
  function control() {
    const scene = new THREE.Scene(), object = new THREE.Object3D()
    scene.add(object)
    const controls = new TransformControls(new THREE.PerspectiveCamera(), undefined)
    controls.attach(object)
    scene.add(controls)
    return controls
  }

  it('ignores inactive pickers and helper geometry while preserving the active picker', () => {
    const controls = control()
    const gizmo = controls.children.find(o => o.type === 'TransformControlsGizmo')! as THREE.Object3D & {
      picker: Record<string, THREE.Object3D>; helper: Record<string, THREE.Object3D>
    }
    const active = gizmo.picker.translate.children[0]
    const inactive = gizmo.picker.rotate.children[0]
    const helper = gizmo.helper.translate.children[0]
    expect(pickKindOf(active)).toBe('gizmo')
    expect(pickKindOf(inactive)).toBeNull()
    expect(pickKindOf(helper)).toBeNull()
    expect(filterViewportHits([{ object: inactive, distance: 1 }, hit('object', 'other', 2)])[0].object.userData.pickId).toBe('other')
    expect(hasInteractivePick([{ object: inactive, distance: 1 }])).toBe(false)
    controls.setMode('rotate')
    expect(pickKindOf(active)).toBeNull()
    expect(pickKindOf(inactive)).toBe('gizmo')
  })

  it('does not pick a hidden object or detached transform control', () => {
    const controls = control()
    controls.detach()
    const gizmo = controls.children.find(o => o.type === 'TransformControlsGizmo')!
    expect(pickKindOf(gizmo.children[3].children[0])).toBeNull()
    const parent = new THREE.Group(), h = hit('object', 'hidden', 1)
    parent.visible = false
    parent.add(h.object)
    expect(pickKindOf(h.object)).toBeNull()
  })
})
