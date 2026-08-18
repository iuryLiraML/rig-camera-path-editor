import type {
  CustomSkill,
  DirectorChatEntry,
  SavedPrompt,
  Shot,
  ShotFormat,
} from '../../state/useProjectStore'
import type { CameraOption } from '../../state/useCameraOptionsStore'
import type { MotionPath } from '../../state/usePathStore'
import type { RigSnapshot } from '../../state/useRigStore'
import type { ObjectMeta } from '../sceneIO'
import type { ProjectRecord } from '../projects'

export interface CloudAssetRef {
  assetId: string
  sha256: string
}

export interface CloudAssetMap {
  bufferAssets: Record<string, CloudAssetRef>
  stillAssets: Record<string, CloudAssetRef>
}

export interface CloudShot {
  id: string
  name: string
  order: number
  rig: RigSnapshot
  format: ShotFormat
  duration: number
  stillAssetId: string | null
}

export interface CloudObjectMeta extends ObjectMeta {
  bufferAssetId: string | null
}

export interface CloudEditorState {
  guidelines: string
  savedPrompts: SavedPrompt[]
  skills: CustomSkill[]
  directorChat: DirectorChatEntry[]
  directorLessons: string[]
  shots: CloudShot[]
  sceneMeta: CloudObjectMeta[]
  rig: RigSnapshot
  paths?: MotionPath[]
  cameraOptions?: CameraOption[]
  activeCameraOptionId?: string
}

export function emptyAssetMap(): CloudAssetMap {
  return { bufferAssets: {}, stillAssets: {} }
}

export function toCloudEditorState(record: ProjectRecord, assets: CloudAssetMap): CloudEditorState {
  return {
    guidelines: record.guidelines,
    savedPrompts: record.savedPrompts,
    skills: record.skills,
    directorChat: record.directorChat ?? [],
    directorLessons: record.directorLessons ?? [],
    shots: record.shots.map((shot) => ({
      id: shot.id,
      name: shot.name,
      order: shot.order,
      rig: shot.rig,
      format: shot.format,
      duration: shot.duration,
      stillAssetId: assets.stillAssets[shot.id]?.assetId ?? null,
    })),
    sceneMeta: record.sceneMeta.map((meta) => ({
      ...meta,
      bufferAssetId: meta.bufferKey ? (assets.bufferAssets[meta.bufferKey]?.assetId ?? null) : null,
    })),
    rig: record.rig,
    paths: record.paths,
    cameraOptions: record.cameraOptions,
    activeCameraOptionId: record.activeCameraOptionId,
  }
}

export function fromCloudEditorState(
  state: CloudEditorState,
  extras: {
    id: string
    name: string
    createdAt: number
    workflow: ProjectRecord['workflow']
    cloudUpdatedAt: string
    shots: Shot[]
  },
): ProjectRecord {
  return {
    id: extras.id,
    name: extras.name,
    createdAt: extras.createdAt,
    updatedAt: extras.createdAt,
    cloudProjectId: extras.id,
    cloudUpdatedAt: extras.cloudUpdatedAt,
    workflow: extras.workflow,
    guidelines: state.guidelines ?? '',
    savedPrompts: state.savedPrompts ?? [],
    skills: state.skills ?? [],
    directorChat: state.directorChat ?? [],
    directorLessons: state.directorLessons ?? [],
    shots: extras.shots,
    sceneMeta: state.sceneMeta.map(({ bufferAssetId: _bufferAssetId, ...meta }) => meta),
    rig: state.rig,
    paths: state.paths,
    cameraOptions: state.cameraOptions,
    activeCameraOptionId: state.activeCameraOptionId,
    bufferAssets: Object.fromEntries(
      state.sceneMeta
        .filter((meta): meta is CloudObjectMeta & { bufferKey: string; bufferAssetId: string } =>
          Boolean(meta.bufferKey && meta.bufferAssetId),
        )
        .map((meta) => [meta.bufferKey, { assetId: meta.bufferAssetId, sha256: '' }]),
    ),
    stillAssets: Object.fromEntries(
      state.shots
        .filter((shot): shot is CloudShot & { stillAssetId: string } => Boolean(shot.stillAssetId))
        .map((shot) => [shot.id, { assetId: shot.stillAssetId, sha256: '' }]),
    ),
  }
}

export function parseCloudEditorState(value: unknown): CloudEditorState {
  if (!value || typeof value !== 'object') {
    throw new Error('The project snapshot is missing.')
  }
  const state = value as CloudEditorState
  if (!Array.isArray(state.shots) || !Array.isArray(state.sceneMeta)) {
    throw new Error('The project snapshot is missing shots or scene data.')
  }
  return state
}
