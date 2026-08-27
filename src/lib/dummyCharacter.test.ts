import { afterEach, describe, expect, it } from 'vitest'
import { addDummyToScene } from './dummyCharacter'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'

afterEach(() => {
  useSceneStore.setState({ objects: [] })
  useEditorStore.setState({ selection: null })
})

describe('addDummyToScene', () => {
  it('adds a grayscale dummy with Idle Walk Run and does not select as a Gaussian', () => {
    const id = addDummyToScene()
    const object = useSceneStore.getState().objects.find((item) => item.id === id)
    expect(object?.rigKind).toBe('dummy')
    expect(object?.playClips).toBe(true)
    expect(object?.clips.map((clip) => clip.name)).toEqual(['Idle', 'Walk', 'Run'])
    const walk = object?.clips.find((clip) => clip.name === 'Walk')
    expect(walk?.tracks.some((track) => track.name.includes('LeftLeg'))).toBe(true)
    expect(walk?.tracks.some((track) => track.name.includes('RightLeg'))).toBe(true)
    expect(useEditorStore.getState().selection).toBe(`obj:${id}`)
  })
})
