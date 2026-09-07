import { CAMERA_PATH_ID, usePathStore, type MotionPath } from './usePathStore'
import { useRigStore } from './useRigStore'

/**
 * Resolve the camera-followed path without importing the rest of the link
 * module. The rig snapshot must call this; importing `cameraPathLink` here
 * would loop through camera-option init (`getRigSnapshot` at store create).
 */
export function cameraPath(): MotionPath | undefined {
  const paths = usePathStore.getState().paths
  const id = useRigStore.getState().cameraPathId
  return paths.find((path) => path.id === id) ?? paths.find((path) => path.id === CAMERA_PATH_ID)
}

/** Geometry a Shot / project document must bundle so restore follows the same road as preview. */
export function followedPathSnapshot(): {
  pathId: string
  anchors: MotionPath['anchors']
  closed: boolean
  rounding: number
} {
  const path = cameraPath()
  return {
    pathId: path?.id ?? CAMERA_PATH_ID,
    anchors: path?.anchors ?? [],
    closed: path?.closed ?? false,
    rounding: path?.rounding ?? 0.8,
  }
}
