import * as THREE from 'three'
import { useRigStore } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { cameraPath } from '../state/cameraPathLink'
import type { Vec3 } from '../state/useSceneStore'
import { sceneBounds } from '../viewport/SceneObjects'

export type PresetKind = 'orbit' | 'arc' | 'flyover' | 'dolly' | 'crane' | 'pan' | 'tilt' | 'zoom'

export const PRESETS: { kind: PresetKind; label: string; hint: string }[] = [
  { kind: 'orbit', label: 'Orbit', hint: 'Full 360° turn around the model' },
  { kind: 'arc', label: 'Half Arc', hint: '180° sweep in front of the model' },
  { kind: 'flyover', label: 'Flyover', hint: 'Passes over the top of the model' },
  { kind: 'dolly', label: 'Push In', hint: 'Moves from far away to up close' },
  { kind: 'crane', label: 'Crane', hint: 'Rises from low to high on the subject' },
  { kind: 'pan', label: 'Pan', hint: 'Camera holds; look-at sweeps sideways' },
  { kind: 'tilt', label: 'Tilt', hint: 'Camera holds; look-at sweeps up' },
  { kind: 'zoom', label: 'Zoom', hint: 'Holds position and tightens the lens' },
]

/** Generates a camera path around the whole scene's bounding box. */
export function applyCameraPreset(kind: PresetKind) {
  const box = sceneBounds() ?? new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const r = Math.max(size.x, size.z, 1) * 1.6 + 1
  const h = Math.max(center.y, 0.5)

  const rig = useRigStore.getState()
  // presets drive whichever path the active camera follows, not a fixed slot
  const path = usePathStore.getState()
  const targetPathId = cameraPath()?.id ?? CAMERA_PATH_ID
  path.setActivePath(targetPathId)
  const ring = (count: number, from: number, to: number, radius: number, y: number): Vec3[] =>
    Array.from({ length: count }, (_, i) => {
      const a = from + ((to - from) * i) / (count - 1)
      return [center.x + Math.cos(a) * radius, y, center.z + Math.sin(a) * radius] as Vec3
    })

  switch (kind) {
    case 'orbit': {
      const pts = Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2
        return [center.x + Math.cos(a) * r, h + r * 0.25, center.z + Math.sin(a) * r] as Vec3
      })
      path.setPath(pts, true)
      break
    }
    case 'arc':
      path.setPath(ring(5, Math.PI * 0.15, Math.PI * 0.85, r, h + r * 0.2), false)
      break
    case 'flyover':
      path.setPath(
        [
          [center.x - r * 1.3, h + r * 0.5, center.z + r * 1.3],
          [center.x, h + r * 1.5, center.z],
          [center.x + r * 1.3, h + r * 0.5, center.z - r * 1.3],
        ],
        false,
      )
      break
    case 'dolly':
      path.setPath(
        [
          [center.x + r * 1.9, h + r * 0.55, center.z + r * 1.9],
          [center.x + r * 0.55, h + r * 0.12, center.z + r * 0.55],
        ],
        false,
      )
      break
    case 'crane':
      path.setPath(
        [
          [center.x + r * 0.85, Math.max(0.2, h * 0.15), center.z + r * 0.85],
          [center.x + r * 0.85, h + r * 1.15, center.z + r * 0.85],
        ],
        false,
      )
      break
    case 'pan': {
      const hold: Vec3 = [center.x + r * 1.1, h + r * 0.35, center.z + r * 0.15]
      path.setPath([hold, [hold[0] + 0.02, hold[1], hold[2]]], false)
      rig.clearVec3Group('target')
      rig.setLookAtMode('target')
      rig.upsertVec3GroupKey('target', 0, [center.x - size.x * 0.6, center.y, center.z])
      rig.upsertVec3GroupKey('target', 1, [center.x + size.x * 0.6, center.y, center.z])
      break
    }
    case 'tilt': {
      const hold: Vec3 = [center.x + r * 1.1, h + r * 0.4, center.z + r * 1.1]
      path.setPath([hold, [hold[0] + 0.02, hold[1], hold[2]]], false)
      rig.clearVec3Group('target')
      rig.setLookAtMode('target')
      rig.upsertVec3GroupKey('target', 0, [center.x, Math.max(0.1, center.y - size.y * 0.4), center.z])
      rig.upsertVec3GroupKey('target', 1, [center.x, center.y + size.y * 0.6, center.z])
      break
    }
    case 'zoom': {
      const hold: Vec3 = [center.x + r * 1.2, h + r * 0.3, center.z + r * 1.2]
      path.setPath([hold, [hold[0] + 0.02, hold[1], hold[2]]], false)
      rig.clearChannel('fov')
      rig.upsertChannelKey('fov', 0, 70)
      rig.upsertChannelKey('fov', 1, 28)
      break
    }
    default: {
      const _never: never = kind
      return _never
    }
  }

  if (kind !== 'pan' && kind !== 'tilt') {
    rig.setTarget([center.x, center.y, center.z])
  }
  path.setDrawPlaneY(h + r * 0.25)
  if (kind !== 'pan' && kind !== 'tilt') rig.setLookAtMode('target')
  rig.setTargetObjectId(null)
}
