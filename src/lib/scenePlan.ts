import {
  openingIssue,
  planFromJSON,
  planRooms,
  planToJSON,
  pointKey,
  wallLength,
  type PlanOpening,
  type PlanPoint,
  type PlanRoom,
  type PlanState,
  type PlanWall,
  type StoredPlan,
} from './floorPlanModel'

/** A direct viewport pick while a Scene Plan is in its explicit edit mode. */
export type ScenePlanTarget =
  | { kind: 'room'; roomKey: string }
  | { kind: 'wall'; wallId: string }
  | { kind: 'opening'; openingId: string }

export type ScenePlanMutation = {
  plan: StoredPlan
  changed: boolean
  note?: string
}

const EPSILON = 1e-6
const MIN_WALL_LENGTH = 0.25

function cloneStoredPlan(plan: StoredPlan): StoredPlan {
  return structuredClone(plan)
}

function serialize(state: PlanState, changed: boolean, note?: string): ScenePlanMutation {
  return { plan: planToJSON(state), changed, ...(note ? { note } : {}) }
}

function wallBetween(a: PlanPoint, b: PlanPoint, walls: PlanWall[]): PlanWall | undefined {
  const aKey = pointKey(a)
  const bKey = pointKey(b)
  return walls.find((wall) => (
    (pointKey(wall.a) === aKey && pointKey(wall.b) === bKey)
    || (pointKey(wall.a) === bKey && pointKey(wall.b) === aKey)
  ))
}

/** A room is derived, so its stable identity is the sorted set of enclosing wall ids. */
export function roomKey(room: PlanRoom, walls: PlanWall[]): string {
  const ids = room.points.map((point, index) => {
    const next = room.points[(index + 1) % room.points.length]!
    return wallBetween(point, next, walls)?.id
  })
  if (ids.some((id) => !id)) return `points:${room.points.map(pointKey).sort().join('|')}`
  return `walls:${(ids as string[]).sort().join('|')}`
}

export function findRoomByKey(state: Pick<PlanState, 'walls'>, key: string): PlanRoom | undefined {
  return planRooms(state.walls).find((room) => roomKey(room, state.walls) === key)
}

function mutate(plan: StoredPlan, update: (state: PlanState) => { changed: boolean; note?: string }): ScenePlanMutation {
  const state = planFromJSON(cloneStoredPlan(plan))
  const result = update(state)
  return result.changed ? serialize(state, true, result.note) : { plan: cloneStoredPlan(plan), ...result }
}

function replaceSharedPoint(state: PlanState, from: PlanPoint, to: PlanPoint): void {
  const key = pointKey(from)
  for (const wall of state.walls) {
    if (pointKey(wall.a) === key) wall.a = { ...to }
    if (pointKey(wall.b) === key) wall.b = { ...to }
  }
}

function hostedOpeningMinimumLength(state: PlanState, wallId: string): number {
  return state.openings
    .filter((opening) => opening.wallId === wallId)
    .reduce((minimum, opening) => Math.max(minimum, opening.along + opening.width / 2), MIN_WALL_LENGTH)
}

function stateWithWallEndpoint(state: PlanState, wallId: string, length: number): PlanState | null {
  const next = structuredClone(state)
  const wall = next.walls.find((item) => item.id === wallId)
  if (!wall) return null
  const currentLength = wallLength(wall)
  if (currentLength < EPSILON) return null
  const ux = (wall.b.x - wall.a.x) / currentLength
  const uy = (wall.b.y - wall.a.y) / currentLength
  replaceSharedPoint(next, wall.b, { x: wall.a.x + ux * length, y: wall.a.y + uy * length })
  return next
}

function wallResizeIsValid(state: PlanState, wallId: string, length: number): boolean {
  const next = stateWithWallEndpoint(state, wallId, length)
  if (!next) return false
  return next.walls.every((wall) => wallLength(wall) >= MIN_WALL_LENGTH - EPSILON)
    && next.openings.every((opening) => openingIssue(next, opening) === null)
}

/**
 * Resize from a wall's `a` endpoint. Hosted openings retain their exact distance
 * from that fixed endpoint; the requested length stops before any opening would
 * need to move, shrink, center, or detach.
 */
export function resizeScenePlanWall(plan: StoredPlan, wallId: string, requestedLength: number): ScenePlanMutation {
  return mutate(plan, (state) => {
    const wall = state.walls.find((item) => item.id === wallId)
    if (!wall || !Number.isFinite(requestedLength)) return { changed: false, note: 'Choose a valid wall length.' }
    const currentLength = wallLength(wall)
    if (currentLength < EPSILON) return { changed: false, note: 'This wall has no direction to resize.' }
    const minimum = hostedOpeningMinimumLength(state, wallId)
    const wanted = Math.max(minimum, requestedLength)
    let length = wanted
    if (!wallResizeIsValid(state, wallId, wanted)) {
      if (!wallResizeIsValid(state, wallId, currentLength)) {
        return { changed: false, note: 'This wall is already invalid and cannot be resized safely.' }
      }
      let invalid = wanted
      let valid = currentLength
      for (let i = 0; i < 40; i += 1) {
        const middle = (invalid + valid) / 2
        if (wallResizeIsValid(state, wallId, middle)) valid = middle
        else invalid = middle
      }
      length = valid
    }
    if (Math.abs(length - currentLength) < EPSILON) {
      return { changed: false, ...(requestedLength < minimum ? { note: 'The wall stops at the fixed endpoint limit of its opening.' } : {}) }
    }
    const next = stateWithWallEndpoint(state, wallId, length)
    if (!next) return { changed: false, note: 'This wall has no direction to resize.' }
    state.walls = next.walls
    state.version += 1
    return {
      changed: true,
      ...(requestedLength < minimum ? { note: 'The wall stopped at the fixed endpoint limit of its opening.' } : {}),
    }
  })
}

export function updateScenePlanWall(
  plan: StoredPlan,
  wallId: string,
  patch: Partial<Pick<PlanWall, 'height' | 'thickness'>>,
): ScenePlanMutation {
  return mutate(plan, (state) => {
    const wall = state.walls.find((item) => item.id === wallId)
    if (!wall) return { changed: false, note: 'Choose a wall first.' }
    const requestedHeight = patch.height ?? wall.height
    const openingMinimumHeight = state.openings
      .filter((opening) => opening.wallId === wallId)
      .reduce((minimum, opening) => Math.max(minimum, opening.sill + opening.height), 0.01)
    const height = Math.max(openingMinimumHeight, requestedHeight)
    const thickness = patch.thickness ?? wall.thickness
    if (!Number.isFinite(height) || !Number.isFinite(thickness) || height <= 0 || thickness <= 0) {
      return { changed: false, note: 'Enter valid wall dimensions.' }
    }
    if (Math.abs(wall.height - height) < EPSILON && Math.abs(wall.thickness - thickness) < EPSILON) return { changed: false }
    wall.height = height
    wall.thickness = thickness
    state.version += 1
    return {
      changed: true,
      ...(requestedHeight < openingMinimumHeight ? { note: 'The wall stopped at the height of its opening.' } : {}),
    }
  })
}

function closestOpeningPosition(state: PlanState, opening: PlanOpening, proposed: PlanOpening, requestedAlong: number): number | null {
  const wall = state.walls.find((item) => item.id === opening.wallId)
  if (!wall) return null
  const length = wallLength(wall)
  const minimum = proposed.width / 2
  const maximum = length - proposed.width / 2
  if (minimum > maximum + EPSILON) return null

  const candidates = [Math.max(minimum, Math.min(maximum, requestedAlong))]
  for (const other of state.openings) {
    if (other.id === opening.id || other.wallId !== opening.wallId) continue
    const separation = (other.width + proposed.width) / 2
    candidates.push(other.along - separation, other.along + separation)
  }

  const valid = candidates
    .map((along) => Math.max(minimum, Math.min(maximum, along)))
    .filter((along, index, values) => values.indexOf(along) === index)
    .filter((along) => !openingIssue(state, { ...proposed, along }))

  if (valid.length === 0) return null
  return valid.reduce((closest, along) => (
    Math.abs(along - requestedAlong) < Math.abs(closest - requestedAlong) ? along : closest
  ))
}

function candidateOpening(state: PlanState, opening: PlanOpening, patch: Partial<Pick<PlanOpening, 'along' | 'width' | 'height' | 'sill'>>): PlanOpening | null {
  const wall = state.walls.find((item) => item.id === opening.wallId)
  if (!wall) return null
  const length = wallLength(wall)
  const rawAlong = patch.along ?? opening.along

  const forWidth = (requestedWidth: number): PlanOpening => {
    const width = Math.max(0.01, Math.min(length, requestedWidth))
    let height = Math.max(0.01, patch.height ?? opening.height)
    let sill = opening.kind === 'door' ? 0 : Math.max(0, patch.sill ?? opening.sill)
    if (sill + height > wall.height) {
      if (patch.height !== undefined) height = Math.max(0.01, wall.height - sill)
      else sill = Math.max(0, wall.height - height)
    }
    return { ...opening, width, height, sill, along: Math.max(width / 2, Math.min(length - width / 2, rawAlong)) }
  }

  const provisional = forWidth(patch.width ?? opening.width)
  const place = (candidate: PlanOpening) => {
    const along = closestOpeningPosition(state, opening, candidate, rawAlong)
    return along === null ? candidate : { ...candidate, along }
  }
  let candidate = place(provisional)
  if (patch.width !== undefined && openingIssue(state, candidate) && patch.width > opening.width) {
    let validWidth = opening.width
    let invalidWidth = Math.min(length, patch.width)
    if (openingIssue(state, place(forWidth(validWidth))) === null) {
      for (let i = 0; i < 40; i += 1) {
        const middle = (validWidth + invalidWidth) / 2
        if (openingIssue(state, place(forWidth(middle))) === null) validWidth = middle
        else invalidWidth = middle
      }
      candidate = place(forWidth(validWidth))
    }
  }
  return candidate
}

export function updateScenePlanOpening(
  plan: StoredPlan,
  openingId: string,
  patch: Partial<Pick<PlanOpening, 'along' | 'width' | 'height' | 'sill'>>,
): ScenePlanMutation {
  return mutate(plan, (state) => {
    const opening = state.openings.find((item) => item.id === openingId)
    if (!opening) return { changed: false, note: 'Choose a door or window first.' }
    const candidate = candidateOpening(state, opening, patch)
    if (!candidate) return { changed: false, note: 'The opening no longer has a wall.' }
    const issue = openingIssue(state, candidate)
    if (issue) return { changed: false, note: issue }
    if (JSON.stringify(candidate) === JSON.stringify(opening)) return { changed: false }
    Object.assign(opening, candidate)
    state.version += 1
    return { changed: true }
  })
}

export function isRectangularRoom(room: PlanRoom): boolean {
  if (room.points.length !== 4) return false
  const vectors = room.points.map((point, index) => {
    const next = room.points[(index + 1) % room.points.length]!
    return { x: next.x - point.x, y: next.y - point.y }
  })
  return vectors.every((vector, index) => {
    const next = vectors[(index + 1) % vectors.length]!
    return Math.abs(vector.x * next.x + vector.y * next.y) < 1e-4
  })
}

/** Resize a four-corner room from its first derived corner, preserving a closed loop. */
export function resizeScenePlanRoom(
  plan: StoredPlan,
  key: string,
  patch: { width?: number; depth?: number },
): ScenePlanMutation {
  return mutate(plan, (state) => {
    const room = findRoomByKey(state, key)
    if (!room || !isRectangularRoom(room)) return { changed: false, note: 'Room dimensions are available for rectangular rooms.' }
    const [p0, p1, , p3] = room.points
    const currentWidth = Math.hypot(p1!.x - p0!.x, p1!.y - p0!.y)
    const currentDepth = Math.hypot(p3!.x - p0!.x, p3!.y - p0!.y)
    const width = patch.width ?? currentWidth
    const depth = patch.depth ?? currentDepth
    if (!Number.isFinite(width) || !Number.isFinite(depth) || width < MIN_WALL_LENGTH || depth < MIN_WALL_LENGTH) {
      return { changed: false, note: 'Room dimensions must be positive.' }
    }
    if (Math.abs(width - currentWidth) < EPSILON && Math.abs(depth - currentDepth) < EPSILON) return { changed: false }
    const ux = (p1!.x - p0!.x) / currentWidth
    const uy = (p1!.y - p0!.y) / currentWidth
    const vx = (p3!.x - p0!.x) / currentDepth
    const vy = (p3!.y - p0!.y) / currentDepth
    const nextPoints: [PlanPoint, PlanPoint, PlanPoint, PlanPoint] = [
      p0!,
      { x: p0!.x + ux * width, y: p0!.y + uy * width },
      { x: p0!.x + ux * width + vx * depth, y: p0!.y + uy * width + vy * depth },
      { x: p0!.x + vx * depth, y: p0!.y + vy * depth },
    ]
    const replacements = new Map(room.points.map((point, index) => [pointKey(point), nextPoints[index]!]))
    const original = state.walls.map((wall) => ({ ...wall, a: { ...wall.a }, b: { ...wall.b } }))
    for (const wall of state.walls) {
      const a = replacements.get(pointKey(wall.a))
      const b = replacements.get(pointKey(wall.b))
      if (a) wall.a = { ...a }
      if (b) wall.b = { ...b }
    }
    for (const opening of state.openings) {
      const wall = state.walls.find((item) => item.id === opening.wallId)
      if (wall && openingIssue(state, opening)) {
        state.walls = original
        return { changed: false, note: 'That room size would invalidate a door or window.' }
      }
    }
    state.version += 1
    return { changed: true }
  })
}
