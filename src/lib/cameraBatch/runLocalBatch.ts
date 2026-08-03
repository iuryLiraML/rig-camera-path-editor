import type { CameraProfile, PlannedShot } from '../projectWorkflow'
import type { PresetKind } from '../presets'
import { applyCameraPreset } from '../presets'
import { beginGeneratedCameraOption, useCameraOptionsStore } from '../../state/useCameraOptionsStore'
import { getRigSnapshot, useRigStore } from '../../state/useRigStore'
import { useEditorStore } from '../../state/useEditorStore'
import { CAMERA_PATH_ID, usePathStore } from '../../state/usePathStore'
import { captureThumbnail } from '../projects'
import { useProjectStore, type Shot } from '../../state/useProjectStore'
import { makeSceneId } from '../../state/useSceneStore'

export function profileToPreset(profile: CameraProfile): PresetKind {
  switch (profile) {
    case 'packshot':
    case 'reveal-orbit':
      return 'orbit'
    case 'dolly':
      return 'dolly'
    case 'fpv-drone':
      return 'flyover'
    case 'custom':
      return 'arc'
    default: {
      const _exhaustive: never = profile
      return _exhaustive
    }
  }
}

/** Builds one camera option + Board shot from a planned shot list entry. */
export async function materializePlannedShot(planned: PlannedShot): Promise<{
  cameraOptionId: string
  storyboardShotId: string
}> {
  const camera = beginGeneratedCameraOption(planned.name)
  applyCameraPreset(profileToPreset(planned.profile))
  useRigStore.getState().setDuration(planned.durationSeconds)
  useRigStore.getState().setLoop(false)
  useCameraOptionsStore.getState().captureActive()
  useEditorStore.getState().select('cinema-camera')

  const path = usePathStore.getState().getPath(CAMERA_PATH_ID)
  if ((path?.anchors.length ?? 0) < 2) {
    throw new Error(`Camera path for "${planned.name}" was not generated.`)
  }

  const editor = useEditorStore.getState()
  const project = useProjectStore.getState()
  const shot: Shot = {
    id: makeSceneId('shot'),
    name: planned.name,
    order: project.shots.length,
    rig: getRigSnapshot(),
    format: {
      aspect: editor.exportAspect,
      res: editor.exportRes,
      custom: editor.customSize,
    },
    duration: planned.durationSeconds,
    thumbnail: await captureThumbnail(),
  }
  project.addShot(shot)

  return {
    cameraOptionId: camera.id,
    storyboardShotId: shot.id,
  }
}

export interface BatchShotProgress {
  plannedShotId: string
  name: string
  status: 'pending' | 'running' | 'done' | 'failed'
  storyboardShotId?: string
  cameraOptionId?: string
  error?: string
}

export interface CameraBatchProgress {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  cloudJobRunId: string | null
  currentIndex: number
  total: number
  shots: BatchShotProgress[]
  error: string | null
}

export async function runLocalCameraBatch(
  plannedShots: PlannedShot[],
  options: {
    signal?: AbortSignal
    onProgress?: (progress: CameraBatchProgress) => void
    cloudJobRunId?: string | null
  } = {},
): Promise<CameraBatchProgress> {
  const shots: BatchShotProgress[] = plannedShots.map((shot) => ({
    plannedShotId: shot.id,
    name: shot.name,
    status: 'pending',
  }))

  const emit = (patch: Partial<CameraBatchProgress>): CameraBatchProgress => {
    const progress: CameraBatchProgress = {
      status: patch.status ?? 'running',
      cloudJobRunId: options.cloudJobRunId ?? null,
      currentIndex: patch.currentIndex ?? 0,
      total: plannedShots.length,
      shots: [...shots],
      error: patch.error ?? null,
    }
    options.onProgress?.(progress)
    return progress
  }

  if (plannedShots.length === 0) {
    return emit({ status: 'failed', error: 'No approved planned shots to generate.' })
  }

  emit({ status: 'running', currentIndex: 0 })

  for (let index = 0; index < plannedShots.length; index += 1) {
    if (options.signal?.aborted) {
      return emit({ status: 'cancelled', currentIndex: index, error: 'Batch cancelled.' })
    }

    const planned = plannedShots[index]
    shots[index] = { ...shots[index], status: 'running' }
    emit({ status: 'running', currentIndex: index })

    try {
      const result = await materializePlannedShot(planned)
      shots[index] = {
        ...shots[index],
        status: 'done',
        storyboardShotId: result.storyboardShotId,
        cameraOptionId: result.cameraOptionId,
      }
    } catch (error) {
      shots[index] = {
        ...shots[index],
        status: 'failed',
        error: error instanceof Error ? error.message : 'Shot generation failed',
      }
      return emit({
        status: 'failed',
        currentIndex: index,
        error: shots[index].error ?? 'Shot generation failed',
      })
    }
  }

  return emit({ status: 'completed', currentIndex: plannedShots.length })
}
