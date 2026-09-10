/**
 * The one piece→mesh builder for a floor plan's extrusion. The preview, the
 * card thumbnail, and scene insertion all render the same geometry, so they
 * share this — the extrusion math lives in the pure model, and the mesh
 * construction lives here. A fourth copy would drift, as the third did.
 */
import * as THREE from 'three'
import { planExtrude, planFromJSON, planRooms, wallBasis, type PlanState, type StoredPlan } from './floorPlanModel'
import { clayFloorMaterial, clayMaterial } from './clayMaterial'

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
    group.add(mesh)
  }
  // a floor slab per derived room (FR-032); no ceiling
  for (const room of planRooms(state.walls)) {
    const shape = new THREE.Shape(room.points.map((p) => new THREE.Vector2(p.x, p.y)))
    const geo = new THREE.ShapeGeometry(shape)
    geo.rotateX(Math.PI / 2)
    const slab = new THREE.Mesh(geo, floor)
    slab.position.y = 0.005
    group.add(slab)
  }
  return group
}
