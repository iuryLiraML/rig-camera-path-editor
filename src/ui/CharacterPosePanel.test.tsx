// @vitest-environment jsdom
import { fireEvent, render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ensureDummyTemplateFromBuffer, makeDummyObject } from '../lib/dummyCharacter'
import { useSceneStore } from '../state/useSceneStore'
import { resetHistory, undo } from '../lib/history'
import { CharacterPosePanel } from './CharacterPosePanel'

beforeEach(async () => {
  const bytes = readFileSync('public/dummy/Male.glb')
  await ensureDummyTemplateFromBuffer('male', new Uint8Array(bytes).buffer)
  const object = makeDummyObject({ figureSex: 'male' })
  useSceneStore.setState({ objects: [object] })
  resetHistory()
})
afterEach(cleanup)

it('edits a pose without selecting a viewport joint and records one undo step', () => {
  const screen = render(<CharacterPosePanel objectId={useSceneStore.getState().objects[0].id} />)
  const slider = screen.getByRole('slider', { name: 'Left forearm Bend' })
  fireEvent.pointerDown(slider)
  fireEvent.change(slider, { target: { value: '45' } })
  fireEvent.change(slider, { target: { value: '90' } })
  fireEvent.pointerUp(slider)
  expect(useSceneStore.getState().objects[0].bonePose?.LeftForearm).toBeDefined()
  undo()
  expect(useSceneStore.getState().objects[0].bonePose).toBeUndefined()
})

it('cancels a slider gesture and preserves clips', () => {
  const original = useSceneStore.getState().objects[0]
  const screen = render(<CharacterPosePanel objectId={original.id} />)
  const slider = screen.getByRole('slider', { name: 'Left forearm Bend' })
  fireEvent.pointerDown(slider)
  fireEvent.change(slider, { target: { value: '70' } })
  fireEvent.keyDown(slider, { key: 'Escape' })
  expect(useSceneStore.getState().objects[0].bonePose).toBeUndefined()
  expect(useSceneStore.getState().objects[0].clips).toEqual(original.clips)
})

it('keeps numeric caret edits in one transaction and steps by one degree', () => {
  const screen = render(<CharacterPosePanel objectId={useSceneStore.getState().objects[0].id} />)
  const number = screen.getByRole('spinbutton', { name: 'Left forearm Bend degrees' })
  fireEvent.focus(number)
  fireEvent.change(number, { target: { value: '30' } })
  fireEvent.keyDown(number, { key: 'ArrowLeft' }); fireEvent.keyUp(number, { key: 'ArrowLeft' })
  fireEvent.change(number, { target: { value: '60.5' } })
  fireEvent.keyDown(number, { key: 'ArrowUp' }); fireEvent.keyUp(number, { key: 'ArrowUp' })
  expect((number as HTMLInputElement).value).toBe('61.5')
  fireEvent.blur(number)
  undo()
  expect(useSceneStore.getState().objects[0].bonePose).toBeUndefined()
})

it('explains that a SAM static mesh is not a poseable rig', async () => {
  const THREE = await import('three')
  const { makeObject } = await import('../state/useSceneStore')
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry()))
  const object = makeObject('SAM person', root, { rigKind: 'sam-person' })
  useSceneStore.setState({ objects: [object] })
  const screen = render(<CharacterPosePanel objectId={object.id} />)
  expect(screen.getByText('Static mesh')).toBeTruthy()
  expect(screen.getByText(/Reconstruction data is unavailable/)).toBeTruthy()
  expect(screen.queryByRole('slider')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Create editable rig' })).toBeNull()
})

it('distinguishes an imported skin from a supported humanoid without guessing a profile', () => {
  const figure = useSceneStore.getState().objects[0]
  delete figure.root.userData.dummyGltf
  useSceneStore.setState({ objects: [{ ...figure, rigKind: 'sam-person' }] })
  const screen = render(<CharacterPosePanel objectId={figure.id} />)
  expect(screen.getByText('Skinned rig')).toBeTruthy()
  expect(screen.queryByRole('slider')).toBeNull()
})


it('does not label malformed skin weights as an editable rig', async () => {
  const THREE = await import('three')
  const figure = useSceneStore.getState().objects[0]
  figure.root.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry = node.geometry.clone()
    if (node instanceof THREE.SkinnedMesh) node.geometry.getAttribute('skinWeight').setX(0, NaN)
  })
  delete figure.root.userData.dummyGltf
  useSceneStore.setState({ objects: [{ ...figure, rigKind: 'sam-person' }] })
  const screen = render(<CharacterPosePanel objectId={figure.id} />)
  expect(screen.getByText('Static mesh')).toBeTruthy()
  expect(screen.getByText(/invalid joint weights/)).toBeTruthy()
  expect(screen.queryByRole('slider')).toBeNull()
})
