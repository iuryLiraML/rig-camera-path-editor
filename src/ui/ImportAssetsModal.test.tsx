// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FAL_REMESH_MAX_BYTES, HEAVY_TRIANGLES, RETOPO_TRIANGLES } from '../lib/sceneIO'
import { useEditorStore } from '../state/useEditorStore'
import { ImportAssetsModal } from './ImportAssetsModal'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ showImportModal: false })
})

describe('Import remesh warning', () => {
  it('keeps the 80k / 1.5M / 150 MB thresholds', () => {
    expect(RETOPO_TRIANGLES).toBe(80_000)
    expect(HEAVY_TRIANGLES).toBe(1_500_000)
    expect(FAL_REMESH_MAX_BYTES).toBe(150 * 1024 * 1024)
  })

  it('is a file picker with no Keep as-is / Remesh choice', () => {
    useEditorStore.setState({ showImportModal: true })
    const { container } = render(<ImportAssetsModal />)
    const text = container.textContent ?? ''
    expect(text).toContain('Import Assets')
    expect(text).toContain('Drag & Drop models or browse.')
    expect(text).not.toContain('Keep as-is')
    expect(text).not.toContain('Dense model')
    expect(text).not.toContain('Remesh with Tripo to a clay-friendly')
  })
})
