import { CAMERA_PATH_ID, usePathStore, type MotionPath } from './usePathStore'
import { useRigStore } from './useRigStore'
import { useCameraOptionsStore } from './useCameraOptionsStore'

/**
 * The link between a camera and the path it follows.
 *
 * `useRigStore.cameraPathId` existed from the start and nothing ever read it: the
 * cinema camera resolved the hard-coded `CAMERA_PATH_ID`, and each camera option
 * carried its own inline copy of the geometry, so switching cameras *overwrote*
 * the single path slot. A camera now points at a path in the collection, and two
 * cameras may share one — edit the road once and every camera on it follows.
 *
 * Everything that used to ask "does `camera-path` have anchors?" asks these
 * helpers instead, so the coupling lives in one file rather than in thirteen.
 */

/** The path the active camera follows, or the camera path if the link dangles. */
export function cameraPath(): MotionPath | undefined {
  const paths = usePathStore.getState().paths
  const id = useRigStore.getState().cameraPathId
  return paths.find((path) => path.id === id) ?? paths.find((path) => path.id === CAMERA_PATH_ID)
}

/** Anchor count of the followed path — the gate for scrubbing, export and the PiP. */
export function cameraAnchorCount(): number {
  return cameraPath()?.anchors.length ?? 0
}

/**
 * Reactive forms. A component must subscribe to BOTH stores: the link lives in the
 * rig, the geometry in the path collection, so a plain selector over one of them
 * would miss changes to the other.
 */
export function useCameraPath(): MotionPath | undefined {
  const id = useRigStore((state) => state.cameraPathId)
  return usePathStore(
    (state) =>
      state.paths.find((path) => path.id === id) ??
      state.paths.find((path) => path.id === CAMERA_PATH_ID),
  )
}

export function useCameraAnchorCount(): number {
  return useCameraPath()?.anchors.length ?? 0
}

/**
 * Whether the active camera can be rendered/scrubbed/exported: a path camera
 * needs two anchors; a static (manually-posed) camera is always ready.
 */
export function cameraReady(): boolean {
  return useRigStore.getState().cameraKind === 'static' || cameraAnchorCount() >= 2
}

export function useCameraReady(): boolean {
  const kind = useRigStore((state) => state.cameraKind)
  const count = useCameraAnchorCount()
  return kind === 'static' || count >= 2
}

/**
 * Which cameras follow each path, by name. The panel shows this next to the
 * picker: sharing a path is the point, but discovering it by surprise when an
 * edit moves another camera is not.
 */
export function pathsUsedByCameras(): Map<string, string[]> {
  const used = new Map<string, string[]>()
  for (const option of useCameraOptionsStore.getState().options) {
    const id = option.rig.pathId ?? CAMERA_PATH_ID
    const names = used.get(id)
    if (names) names.push(option.name)
    else used.set(id, [option.name])
  }
  return used
}

/** Cameras other than `exceptOptionId` that follow `pathId`. */
export function otherCamerasOnPath(pathId: string, exceptOptionId: string): string[] {
  return useCameraOptionsStore
    .getState()
    .options.filter(
      (option) => option.id !== exceptOptionId && (option.rig.pathId ?? CAMERA_PATH_ID) === pathId,
    )
    .map((option) => option.name)
}

/**
 * Reactive: names of the cameras following `pathId`. The outliner uses it to
 * refuse deleting a path that a camera still travels along — a dangling camera
 * would silently fall back to the camera path, losing the move without a word.
 */
export function useCameraFollowers(pathId: string): string[] {
  const options = useCameraOptionsStore((state) => state.options)
  return options
    .filter((option) => (option.rig.pathId ?? CAMERA_PATH_ID) === pathId)
    .map((option) => option.name)
}
