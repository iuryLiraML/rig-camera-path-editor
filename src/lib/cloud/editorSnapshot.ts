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
import type { ProjectRecord, SceneRecord } from '../projects'

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

export interface CloudSceneState {
  id: string
  name: string
  order: number
  createdAt: number
  directorChat: DirectorChatEntry[]
  directorLessons: string[]
  shots: CloudShot[]
  sceneMeta: CloudObjectMeta[]
  rig: RigSnapshot
  paths?: MotionPath[]
  cameraOptions?: CameraOption[]
  activeCameraOptionId?: string
}

export interface CloudEditorState {
  guidelines: string
  savedPrompts: SavedPrompt[]
  skills: CustomSkill[]
  activeSceneId: string
  scenes: CloudSceneState[]
}

/** The shape written before the Scene tier existed — one scene's fields at the root. */
interface LegacyCloudEditorState {
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
  scenes?: undefined
}

/** Deterministic, mirrors the local-record legacy migration in lib/projects.ts. */
const LEGACY_CLOUD_SCENE_ID = 'scene-legacy'

function migrateLegacyCloudState(state: LegacyCloudEditorState): CloudEditorState {
  return {
    guidelines: state.guidelines ?? '',
    savedPrompts: state.savedPrompts ?? [],
    skills: state.skills ?? [],
    activeSceneId: LEGACY_CLOUD_SCENE_ID,
    scenes: [
      {
        id: LEGACY_CLOUD_SCENE_ID,
        name: 'Scene 1',
        order: 0,
        createdAt: Date.now(),
        directorChat: state.directorChat ?? [],
        directorLessons: state.directorLessons ?? [],
        shots: state.shots ?? [],
        sceneMeta: state.sceneMeta ?? [],
        rig: state.rig,
        paths: state.paths,
        cameraOptions: state.cameraOptions,
        activeCameraOptionId: state.activeCameraOptionId,
      },
    ],
  }
}

export function emptyAssetMap(): CloudAssetMap {
  return { bufferAssets: {}, stillAssets: {} }
}

export function toCloudEditorState(record: ProjectRecord, assets: CloudAssetMap): CloudEditorState {
  return {
    guidelines: record.guidelines,
    savedPrompts: record.savedPrompts,
    skills: record.skills,
    activeSceneId: record.activeSceneId,
    scenes: record.scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      order: scene.order,
      createdAt: scene.createdAt,
      directorChat: scene.directorChat ?? [],
      directorLessons: scene.directorLessons ?? [],
      shots: scene.shots.map((shot) => ({
        id: shot.id,
        name: shot.name,
        order: shot.order,
        rig: shot.rig,
        format: shot.format,
        duration: shot.duration,
        stillAssetId: assets.stillAssets[shot.id]?.assetId ?? null,
      })),
      sceneMeta: scene.sceneMeta.map((meta) => ({
        ...meta,
        bufferAssetId: meta.bufferKey ? (assets.bufferAssets[meta.bufferKey]?.assetId ?? null) : null,
      })),
      rig: scene.rig,
      paths: scene.paths,
      cameraOptions: scene.cameraOptions,
      activeCameraOptionId: scene.activeCameraOptionId,
    })),
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
    /** hydrated shots (real Blob thumbnails), flat across every scene */
    shots: Shot[]
  },
): ProjectRecord {
  const shotsById = new Map(extras.shots.map((shot) => [shot.id, shot]))
  const scenes: SceneRecord[] = state.scenes.map((scene) => ({
    id: scene.id,
    name: scene.name,
    order: scene.order,
    createdAt: scene.createdAt,
    directorChat: scene.directorChat ?? [],
    directorLessons: scene.directorLessons ?? [],
    shots: scene.shots.map(
      (shot) =>
        shotsById.get(shot.id) ?? {
          id: shot.id,
          name: shot.name,
          order: shot.order,
          rig: shot.rig,
          format: shot.format,
          duration: shot.duration,
          thumbnail: null,
        },
    ),
    sceneMeta: scene.sceneMeta.map(({ bufferAssetId: _bufferAssetId, ...meta }) => meta),
    rig: scene.rig,
    paths: scene.paths,
    cameraOptions: scene.cameraOptions,
    activeCameraOptionId: scene.activeCameraOptionId,
  }))
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
    activeSceneId: state.activeSceneId,
    scenes,
    bufferAssets: Object.fromEntries(
      state.scenes
        .flatMap((scene) => scene.sceneMeta)
        .filter((meta): meta is CloudObjectMeta & { bufferKey: string; bufferAssetId: string } =>
          Boolean(meta.bufferKey && meta.bufferAssetId),
        )
        .map((meta) => [meta.bufferKey, { assetId: meta.bufferAssetId, sha256: '' }]),
    ),
    stillAssets: Object.fromEntries(
      state.scenes
        .flatMap((scene) => scene.shots)
        .filter((shot): shot is CloudShot & { stillAssetId: string } => Boolean(shot.stillAssetId))
        .map((shot) => [shot.id, { assetId: shot.stillAssetId, sha256: '' }]),
    ),
  }
}

export function parseCloudEditorState(value: unknown): CloudEditorState {
  if (!value || typeof value !== 'object') {
    throw new Error('The project snapshot is missing.')
  }
  const state = value as CloudEditorState | LegacyCloudEditorState
  if (Array.isArray(state.scenes)) return state as CloudEditorState
  const legacy = state as LegacyCloudEditorState
  if (!Array.isArray(legacy.shots) || !Array.isArray(legacy.sceneMeta) || !legacy.rig) {
    throw new Error('The project snapshot is missing shots or scene data.')
  }
  return migrateLegacyCloudState(legacy)
}
