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
