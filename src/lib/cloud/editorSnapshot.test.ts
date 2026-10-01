import { describe, expect, it } from 'vitest'
import { makeEmptyRigSnapshot } from '../../state/useCameraOptionsStore'
import type { ProjectRecord, SceneRecord } from '../projects'
import { fromCloudEditorState, toCloudEditorState } from './editorSnapshot'

const emptyRig = makeEmptyRigSnapshot()

const scene: SceneRecord = {
  id: 'scene-1',
  name: 'Scene 1',
  order: 0,
  createdAt: 1,
  shots: [
    {
      id: 'shot-1',
      name: 'Shot 10',
      order: 0,
      rig: emptyRig,
      format: { aspect: '16:9', res: 1080, custom: [1920, 1080] },
      duration: 6,
      thumbnail: null,
    },
  ],
  directorChat: [],
  directorLessons: [],
  sceneMeta: [
    {
      id: 'obj-1',
      name: 'Hull',
      shade: 0.4,
      bufferKey: 'buf-1',
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      keys: [],
      playClips: false,
    },
  ],
  rig: emptyRig,
}

const record: ProjectRecord = {
  id: 'proj-1',
  name: 'Orbit',
  createdAt: 1,
  guidelines: 'Keep the hull in frame',
  savedPrompts: [],
  skills: [],
  activeSceneId: 'scene-1',
  scenes: [scene],
}

describe('editor snapshot serde', () => {
  it('replaces GLB buffers and shot stills with asset ids', () => {
    const state = toCloudEditorState(record, {
      bufferAssets: { 'buf-1': { assetId: 'asset-glb', sha256: 'aa' } },
      stillAssets: { 'shot-1': { assetId: 'asset-still', sha256: 'bb' } },
    })

    expect(JSON.stringify(state)).not.toContain('ArrayBuffer')
    expect(state.scenes[0].sceneMeta[0].bufferAssetId).toBe('asset-glb')
    expect(state.scenes[0].sceneMeta[0].bufferKey).toBe('buf-1')
    expect(state.scenes[0].shots[0].stillAssetId).toBe('asset-still')
    expect(state.guidelines).toBe('Keep the hull in frame')
  })

  it('carries palco and Unplaced through the cloud snapshot', () => {
    const withEnv: ProjectRecord = {
      ...record,
      environments: [{ id: 'env-1', name: 'Beach', bufferKey: 'env-buf', source: 'import', createdAt: 1, format: 'splat' }],
      unplacedAssets: [{ id: 'a1', name: 'Chair', bufferKey: 'chair-buf', rigKind: 'none' }],
      scenes: [{ ...scene, environmentId: 'env-1' }],
    }
    const state = toCloudEditorState(withEnv, {
      bufferAssets: {
        'buf-1': { assetId: 'asset-glb', sha256: 'aa' },
        'env-buf': { assetId: 'asset-env', sha256: 'ee' },
        'chair-buf': { assetId: 'asset-chair', sha256: 'cc' },
      },
      stillAssets: {},
    })
    expect(state.scenes[0].environmentId).toBe('env-1')
    expect((state.environments?.[0] as { bufferAssetId?: string }).bufferAssetId).toBe('asset-env')
    const restored = fromCloudEditorState(state, {
      id: 'cloud-id',
      name: 'Orbit',
      createdAt: 2,
      workflow: record.workflow,
      cloudUpdatedAt: '2026-08-14T00:00:00.000Z',
      shots: [{ ...scene.shots[0], thumbnail: null }],
    })
    expect(restored.environments?.[0]?.bufferKey).toBe('env-buf')
    expect(restored.unplacedAssets?.[0]?.bufferKey).toBe('chair-buf')
    expect(restored.bufferAssets?.['env-buf']?.assetId).toBe('asset-env')
    expect(restored.scenes[0].environmentId).toBe('env-1')
    expect('bufferAssetId' in (restored.environments?.[0] ?? {})).toBe(false)
  })

  it('restores a local record that can be applied without embedding bytes', () => {
    const state = toCloudEditorState(record, {
      bufferAssets: { 'buf-1': { assetId: 'asset-glb', sha256: 'aa' } },
      stillAssets: {},
    })
    const restored = fromCloudEditorState(state, {
      id: 'cloud-id',
      name: 'Orbit',
      createdAt: 2,
      workflow: record.workflow,
      cloudUpdatedAt: '2026-08-14T00:00:00.000Z',
      shots: [{ ...scene.shots[0], thumbnail: null }],
    })

    expect(restored.id).toBe('cloud-id')
    expect(restored.scenes[0].sceneMeta[0].bufferKey).toBe('buf-1')
    expect(restored.bufferAssets?.['buf-1']?.assetId).toBe('asset-glb')
    expect('bufferAssetId' in restored.scenes[0].sceneMeta[0]).toBe(false)
  })
})

it('preserves reconstruction data and durable artifact references through cloud serialization', () => {
  const reconstruction = { version: 1, provider: 'fal' as const, model: 'fal-ai/sam-3/3d-body', source: { imageUrl: 'https://expired.example/photo' }, metadata: { future: [1, 2] }, artifacts: [{ role: 'visualization', url: 'https://expired.example/result', bufferKey: 'diagnostic' }] }
  const record = { id: 'p', name: 'P', createdAt: 1, activeSceneId: scene.id, guidelines: '', skills: [], savedPrompts: [], scenes: [{ ...scene, sceneMeta: [{ ...scene.sceneMeta[0], reconstruction }] }] }
  const cloud = toCloudEditorState(record, { bufferAssets: { diagnostic: { assetId: 'remote-diagnostic', sha256: 'sha' } }, stillAssets: {} })
  expect(cloud.scenes[0].sceneMeta[0].reconstruction?.artifacts[0]).toMatchObject({ bufferKey: 'diagnostic', cloudAssetId: 'remote-diagnostic' })
  expect(cloud.scenes[0].sceneMeta[0].reconstruction?.source.imageUrl).toBe('')
  expect(cloud.scenes[0].sceneMeta[0].reconstruction?.artifacts[0]?.url).toBe('')
  const restored = fromCloudEditorState(JSON.parse(JSON.stringify(cloud)), { id: 'p', name: 'P', createdAt: 1, shots: [], workflow: undefined, cloudUpdatedAt: '2026-09-10' })
  expect(restored.scenes[0].sceneMeta[0].reconstruction?.metadata).toEqual({ future: [1, 2] })
  expect(restored.bufferAssets?.diagnostic.assetId).toBe('remote-diagnostic')
})
