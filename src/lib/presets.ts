import * as THREE from 'three'
import { useRigStore } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import type { Vec3 } from '../state/useSceneStore'
import { sceneBounds } from '../viewport/SceneObjects'

export type PresetKind = 'orbit' | 'arc' | 'flyover' | 'dolly'

export const PRESETS: { kind: PresetKind; label: string; hint: string }[] = [
  { kind: 'orbit', label: 'Orbit', hint: 'Full 360° turn around the model' },
  { kind: 'arc', label: 'Half Arc', hint: '180° sweep in front of the model' },
  { kind: 'flyover', label: 'Flyover', hint: 'Passes over the top of the model' },
  { kind: 'dolly', label: 'Push In', hint: 'Moves from far away to up close' },
]

/** Generates a camera path around the whole scene's bounding box. */
export function applyCameraPreset(kind: PresetKind) {
  const box = sceneBounds() ?? new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const r = Math.max(size.x, size.z, 1) * 1.6 + 1
  const h = Math.max(center.y, 0.5)

  const rig = useRigStore.getState()
  // presets always drive the camera path — make it active, then write to it
  const path = usePathStore.getState()
  path.setActivePath(CAMERA_PATH_ID)
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
  }

  rig.setTarget([center.x, center.y, center.z])
  path.setDrawPlaneY(h + r * 0.25)
  rig.setLookAtMode('target')
}
