/**
 * The one piece→mesh builder for a floor plan's extrusion. The preview, the
 * card thumbnail, and scene insertion all render the same geometry, so they
 * share this — the extrusion math lives in the pure model, and the mesh
 * construction lives here. A fourth copy would drift, as the third did.
 */
import * as THREE from 'three'
import { openingCenter, planExtrude, planFromJSON, planRooms, wallBasis, type PlanState, type StoredPlan } from './floorPlanModel'
import { clayFloorMaterial, clayMaterial } from './clayMaterial'
import { roomKey, type ScenePlanTarget } from './scenePlan'

export function buildPlanGroup(
  plan: PlanState | StoredPlan,
  materials: { wall?: THREE.Material; floor?: THREE.Material } = {},
): THREE.Group {
  const state: PlanState = 'chain' in plan ? plan : planFromJSON(plan)
  const wall = materials.wall ?? clayMaterial()
  const floor = materials.floor ?? clayFloorMaterial()
  const group = new THREE.Group()
  for (const piece of planExtrude(state)) {
    const w = piece.wall
    const { ux, uy: uz } = wallBasis(w)
    const segLen = piece.to - piece.from
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(segLen, piece.y1 - piece.y0, w.thickness), wall)
    mesh.position.set(w.a.x + ux * (piece.from + segLen / 2), (piece.y0 + piece.y1) / 2, w.a.y + uz * (piece.from + segLen / 2))
    mesh.rotation.y = -Math.atan2(uz, ux)
    mesh.userData.scenePlanTarget = { kind: 'wall', wallId: w.id } satisfies ScenePlanTarget
    group.add(mesh)
  }
  // a floor slab per derived room (FR-032); no ceiling
  for (const room of planRooms(state.walls)) {
    const shape = new THREE.Shape(room.points.map((p) => new THREE.Vector2(p.x, p.y)))
    const geo = new THREE.ShapeGeometry(shape)
    geo.rotateX(Math.PI / 2)
    const slab = new THREE.Mesh(geo, floor)
    slab.position.y = 0.005
    slab.userData.scenePlanTarget = { kind: 'room', roomKey: roomKey(room, state.walls) } satisfies ScenePlanTarget
    group.add(slab)
  }
  // An opening is intentionally a gap in the wall mesh. This transparent
  // raycast target makes the visible doorway/window directly selectable in
  // Scene Plan edit mode without changing the clay render.
  for (const opening of state.openings) {
    const center = openingCenter(state, opening)
    if (!center) continue
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(opening.width, opening.height, center.wall.thickness + 0.08),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    )
    hit.position.set(center.x, opening.sill + opening.height / 2, center.y)
    hit.rotation.y = -Math.atan2(center.uy, center.ux)
    hit.userData.rigPlanHit = true
    hit.userData.scenePlanTarget = { kind: 'opening', openingId: opening.id } satisfies ScenePlanTarget
    group.add(hit)
  }
  return group
}
