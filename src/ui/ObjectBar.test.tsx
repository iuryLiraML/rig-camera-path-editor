// @vitest-environment jsdom
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeObject, useSceneStore } from '../state/useSceneStore'
import { useEditorStore } from '../state/useEditorStore'
import { REMESH_PLACEHOLDER_FLAG } from '../lib/sceneIO'
import { ObjectBar } from './ObjectBar'

function meshRoot() {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
  return root
}

beforeEach(() => {
  useEditorStore.setState({
    selection: null,
    objectBarPanel: 'none',
    showOutliner: false,
    snapEnabled: false,
  })
  useSceneStore.setState({ objects: [], pendingLifts: [] })
})

afterEach(() => {
  cleanup()
  useEditorStore.setState({ selection: null, objectBarPanel: 'none' })
  useSceneStore.setState({ objects: [], pendingLifts: [] })
})

describe('ObjectBar asset display controls', () => {
  it('shows accessible pressed state and cached compact triangle copy for a selected mesh', () => {
    const object = makeObject('Car', meshRoot(), {
      id: 'car',
      triangleCount: 1_900_000,
    })
    useSceneStore.setState({ objects: [object] })
    useEditorStore.setState({ selection: 'obj:car' })

    const { getByRole, getByText } = render(<ObjectBar />)
    const solid = getByRole('button', { name: 'Solid display' })
    const wireframe = getByRole('button', { name: 'Wireframe display' })
    expect(solid.getAttribute('aria-pressed')).toBe('true')
    expect(wireframe.getAttribute('aria-pressed')).toBe('false')
    expect(getByText('1.9M triangles')).toBeTruthy()

    fireEvent.click(wireframe)
    expect(useSceneStore.getState().objects[0]?.displayMode).toBe('wireframe')
    expect(wireframe.getAttribute('aria-pressed')).toBe('true')
  })

  it('does not expose display controls for a non-mesh scene entity', () => {
    const object = makeObject('Empty', new THREE.Group(), { id: 'empty', triangleCount: 0 })
    useSceneStore.setState({ objects: [object] })
    useEditorStore.setState({ selection: 'obj:empty' })

    const { queryByRole, queryByText } = render(<ObjectBar />)
    expect(queryByRole('button', { name: 'Solid display' })).toBeNull()
    expect(queryByText(/triangles$/)).toBeNull()
  })

  it('shows the cached source count and topology warning for a dense placeholder', () => {
    const root = meshRoot()
    root.userData[REMESH_PLACEHOLDER_FLAG] = true
    const object = makeObject('Dense car', root, {
      id: 'dense',
      triangleCount: 240_000,
    })
    useSceneStore.setState({ objects: [object] })
    useEditorStore.setState({ selection: 'obj:dense' })

    const { getByText, queryByRole } = render(<ObjectBar />)
    expect(getByText('Estimated source: 240k triangles')).toBeTruthy()
    expect(getByText('The cube is only a placeholder; source topology is not rendered.')).toBeTruthy()
    expect(queryByRole('button', { name: 'Keep high mesh' })).toBeTruthy()
    expect(queryByRole('button', { name: 'Wireframe display' })).toBeNull()
  })

  it('exposes an accessible clay color input and Reset gray action in Shape', () => {
    const object = makeObject('Car', meshRoot(), {
      id: 'car',
      shade: 0.5,
      clayColor: '#2563eb',
    })
    useSceneStore.setState({ objects: [object] })
    useEditorStore.setState({ selection: 'obj:car', objectBarPanel: 'name' })

    const { getByLabelText, getByRole } = render(<ObjectBar />)
    const color = getByLabelText('Clay color') as HTMLInputElement
    expect(color.type).toBe('color')
    expect(color.value).toBe('#2563eb')

    fireEvent.change(color, { target: { value: '#dc2626' } })
    expect(useSceneStore.getState().objects[0]?.clayColor).toBe('#dc2626')

    fireEvent.click(getByRole('button', { name: 'Reset gray' }))
    expect(useSceneStore.getState().objects[0]?.clayColor).toBe('#bcbcbc')
    expect(color.value).toBe('#bcbcbc')
  })
})
