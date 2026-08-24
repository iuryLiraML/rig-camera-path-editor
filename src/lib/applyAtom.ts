import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { cameraPath } from '../state/cameraPathLink'
import { useRigStore } from '../state/useRigStore'
import { useEditorStore } from '../state/useEditorStore'
import { aspectFromExport, type Aabb } from './agent/framing'
import { isShotAngle, isShotScale, type ShotAngle, type ShotScale } from './agent/shotTypes'
import { instantiateAtom, type AtomKind, type AtomPath } from './atomPath'
import type { Vec3 } from '../state/useSceneStore'
import { vec3GroupHasKeys } from './timelineKey'

export function followedPathId(): string {
  return cameraPath()?.id ?? CAMERA_PATH_ID
}

/** Write geometry onto the path the active camera follows, without stealing pen focus. */
export function mutateFollowedPath(write: () => void): void {
  const path = usePathStore.getState()
  const prev = path.activePathId
  path.setActivePath(followedPathId())
  try {
    write()
  } finally {
    usePathStore.getState().setActivePath(prev)
  }
}

export function applyAtomPath(atom: AtomPath, duration?: number): void {
  const path = usePathStore.getState()
  const rig = useRigStore.getState()
  mutateFollowedPath(() => {
    path.setPath(atom.anchors, atom.closed)
    path.setDrawPlaneY(atom.anchors[0]?.[1] ?? 1)
  })
  rig.setCameraKind('path')
  rig.setFov(atom.fov)
  rig.setRoll(atom.roll)
  rig.setTargetObjectId(null)
  if (atom.lookKeys.length > 0) {
    rig.clearVec3Group('target')
    rig.setLookAtMode('target')
    for (const key of atom.lookKeys) rig.upsertVec3GroupKey('target', key.time, key.target)
  } else {
    rig.setLookAtMode('target')
    rig.setTarget(atom.lookTarget)
    if (vec3GroupHasKeys('target', rig)) rig.clearVec3Group('target')
  }
  if (atom.fovKeys.length > 0) {
    rig.clearChannel('fov')
    for (const key of atom.fovKeys) rig.upsertChannelKey('fov', key.time, key.fov)
  }
  if (typeof duration === 'number' && Number.isFinite(duration)) {
    rig.setDuration(Math.min(30, Math.max(1, duration)))
  }
}

export function atomFromSubject(opts: {
  kind: AtomKind
  subject: Aabb
  scale?: ShotScale
  angle?: ShotAngle
  aspect?: number
}): AtomPath {
  const aspect = opts.aspect ?? aspectFromExport(useEditorStore.getState().exportAspect)
  return instantiateAtom({
    kind: opts.kind,
    subject: opts.subject,
    scale: opts.scale ?? 'auto',
    angle: opts.angle ?? 'eye',
    aspect,
  })
}

export function parseAtomKind(value: unknown): AtomKind | null {
  const kind = String(value ?? '')
  switch (kind) {
    case 'orbit':
    case 'arc':
    case 'flyover':
    case 'dolly':
    case 'crane':
    case 'pan':
    case 'tilt':
    case 'zoom':
      return kind
    default:
      return null
  }
}

export function parseScaleInput(value: unknown): ShotScale {
  const raw = String(value ?? '')
  return isShotScale(raw) ? raw : 'auto'
}

export function parseAngleInput(value: unknown): ShotAngle {
  const raw = String(value ?? '')
  return isShotAngle(raw) ? raw : 'eye'
}

export function formatAtomResult(atom: AtomPath): string {
  const target = atom.lookTarget.map((n) => n.toFixed(2)).join(',')
  return `Instantiated ${atom.kind}: ${atom.anchors.length} anchors, closed=${atom.closed}, radius=${atom.radius.toFixed(2)}, fov=${atom.fov}, look_at=[${target}].`
}

export type { Vec3 }
