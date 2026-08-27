import { describe, expect, it } from 'vitest'
import { deleteStoredEnvironment } from './environmentJobs'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useProjectStore } from '../state/useProjectStore'

describe('deleteStoredEnvironment', () => {
  it('refuses to delete a palco the live scene still uses', () => {
    useProjectStore.setState({ activeSceneId: 'scene-a' })
    useEnvironmentStore.setState({
      environments: [{ id: 'beach', name: 'Beach', bufferKey: 'b', source: 'import', createdAt: 1 }],
      unplacedAssets: [],
      sceneBindings: [{ id: 'scene-a', environmentId: 'beach' }],
      environmentId: 'beach',
    })
    expect(deleteStoredEnvironment('beach')).toBe('Used in 1 scene')
    expect(useEnvironmentStore.getState().environments).toHaveLength(1)
  })

  it('deletes when no scene points at it', () => {
    useProjectStore.setState({ activeSceneId: 'scene-a' })
    useEnvironmentStore.setState({
      environments: [{ id: 'beach', name: 'Beach', bufferKey: 'b', source: 'import', createdAt: 1 }],
      unplacedAssets: [],
      sceneBindings: [{ id: 'scene-a', environmentId: null }],
      environmentId: null,
    })
    expect(deleteStoredEnvironment('beach')).toBeNull()
    expect(useEnvironmentStore.getState().environments).toEqual([])
  })
})

describe('hydrateEnvironment', () => {
  it('unloads the previous splat from GPU state', () => {
    useEnvironmentStore.setState({
      liveBuffer: new ArrayBuffer(8),
      liveFormat: 'splat',
      environmentId: 'old',
    })
    useEnvironmentStore.getState().hydrate({ environments: [], unplacedAssets: [], environmentId: null })
    expect(useEnvironmentStore.getState().liveBuffer).toBeNull()
    expect(useEnvironmentStore.getState().liveFormat).toBeNull()
    expect(useEnvironmentStore.getState().environmentId).toBeNull()
  })
})
