import { create } from 'zustand'
import { makeSceneId, type Transform } from './useSceneStore'
import { useProjectStore } from './useProjectStore'
import {
  IDENTITY_ENV_TRANSFORM,
  assignEnvironmentId,
  type EnvironmentFormat,
  type ProjectEnvironment,
  type ProjectMeshAsset,
} from '../lib/environment'

export type SceneEnvBinding = { id: string; environmentId: string | null }

interface EnvironmentState {
  environments: ProjectEnvironment[]
  unplacedAssets: ProjectMeshAsset[]
  sceneBindings: SceneEnvBinding[]
  environmentId: string | null
  environmentTransform: Transform
  liveBuffer: ArrayBuffer | null
  liveFormat: EnvironmentFormat | null
  sourceImage: Blob | null
  findOpen: boolean
  findPlaceMode: 'unplaced' | 'scene'

  hydrate: (data: {
    environments: ProjectEnvironment[]
    unplacedAssets: ProjectMeshAsset[]
    sceneBindings?: SceneEnvBinding[]
    environmentId?: string | null
    environmentTransform?: Transform | null
  }) => void
  resetLive: () => void
  setEnvironments: (environments: ProjectEnvironment[]) => void
  setUnplacedAssets: (unplacedAssets: ProjectMeshAsset[]) => void
  setLiveBuffer: (buffer: ArrayBuffer | null, format: EnvironmentFormat | null) => void
  setSourceImage: (image: Blob | null) => void
  setFindOpen: (open: boolean) => void
  setFindPlaceMode: (mode: 'unplaced' | 'scene') => void
  setEnvironmentTransform: (transform: Transform) => void
  assignEnvironment: (environmentId: string) => void
  clearEnvironment: () => void
}

const emptyLive = {
  environmentId: null as string | null,
  environmentTransform: IDENTITY_ENV_TRANSFORM,
  liveBuffer: null as ArrayBuffer | null,
  liveFormat: null as EnvironmentFormat | null,
  sourceImage: null as Blob | null,
}

function patchActiveBinding(
  bindings: SceneEnvBinding[],
  environmentId: string | null,
): SceneEnvBinding[] {
  const activeId = useProjectStore.getState().activeSceneId
  if (!activeId) return bindings
  const has = bindings.some((scene) => scene.id === activeId)
  if (!has) return [...bindings, { id: activeId, environmentId }]
  return bindings.map((scene) => (scene.id === activeId ? { ...scene, environmentId } : scene))
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  environments: [],
  unplacedAssets: [],
  sceneBindings: [],
  ...emptyLive,
  findOpen: false,
  findPlaceMode: 'unplaced',

  hydrate: (data) =>
    set({
      environments: data.environments,
      unplacedAssets: data.unplacedAssets,
      sceneBindings: data.sceneBindings ?? [],
      environmentId: data.environmentId ?? null,
      environmentTransform: data.environmentTransform
        ? {
            position: [...data.environmentTransform.position],
            rotation: [...data.environmentTransform.rotation],
            scale: [...data.environmentTransform.scale],
          }
        : IDENTITY_ENV_TRANSFORM,
      liveBuffer: null,
      liveFormat: null,
      sourceImage: null,
      findOpen: false,
      findPlaceMode: 'unplaced',
    }),

  resetLive: () => set({ ...emptyLive, findOpen: false, findPlaceMode: 'unplaced' }),

  setEnvironments: (environments) => set({ environments }),
  setUnplacedAssets: (unplacedAssets) => set({ unplacedAssets }),
  setLiveBuffer: (liveBuffer, liveFormat) => set({ liveBuffer, liveFormat }),
  setSourceImage: (sourceImage) => set({ sourceImage }),
  setFindOpen: (findOpen) => set({ findOpen, findPlaceMode: findOpen ? get().findPlaceMode : 'unplaced' }),
  setFindPlaceMode: (findPlaceMode) => set({ findPlaceMode }),
  setEnvironmentTransform: (environmentTransform) => set({ environmentTransform }),

  assignEnvironment: (environmentId) => {
    const state = get()
    const next = assignEnvironmentId(state.environmentId, environmentId, state.environmentTransform)
    set({
      environmentId: next.environmentId,
      environmentTransform: next.environmentTransform,
      liveBuffer: next.environmentId === state.environmentId ? state.liveBuffer : null,
      liveFormat: next.environmentId === state.environmentId ? state.liveFormat : null,
      sceneBindings: patchActiveBinding(state.sceneBindings, next.environmentId),
    })
  },

  clearEnvironment: () =>
    set((state) => ({
      environmentId: null,
      environmentTransform: IDENTITY_ENV_TRANSFORM,
      liveBuffer: null,
      liveFormat: null,
      sourceImage: null,
      findOpen: false,
      findPlaceMode: 'unplaced',
      sceneBindings: patchActiveBinding(state.sceneBindings, null),
    })),
}))

export function makeEnvironmentId() {
  return makeSceneId('env')
}

export function makeUnplacedId() {
  return makeSceneId('asset')
}
