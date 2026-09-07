import { describe, expect, it } from 'vitest'
import {
  PATH_FOLLOWED,
  PATH_INACTIVE,
  PATH_SELECTED_HALO,
  pathLineAppearance,
  pathOverlay,
} from './pathVisual'

describe('pathLineAppearance', () => {
  it('uses accent blue for the camera-followed path', () => {
    expect(pathLineAppearance(true, false)).toMatchObject({
      color: PATH_FOLLOWED,
      halo: false,
      lineWidth: 2,
    })
  })

  it('uses gray clay for an inactive path', () => {
    expect(pathLineAppearance(false, false)).toMatchObject({
      color: PATH_INACTIVE,
      halo: false,
      lineWidth: 1.5,
    })
  })

  it('adds a white halo when the path is selected for editing', () => {
    const look = pathLineAppearance(false, true)
    expect(look.halo).toBe(true)
    expect(look.haloColor).toBe(PATH_SELECTED_HALO)
    expect(look.color).toBe(PATH_INACTIVE)
  })

  it('composes follow blue with a white halo when both states apply', () => {
    const look = pathLineAppearance(true, true)
    expect(look.color).toBe(PATH_FOLLOWED)
    expect(look.halo).toBe(true)
    expect(look.haloColor).toBe(PATH_SELECTED_HALO)
  })
})

describe('pathOverlay', () => {
  it('keeps a stroke in Build when the path is edit-active and every anchor is selected', () => {
    const overlay = pathOverlay({
      playMode: false,
      workspaceMode: 'build',
      hidden: false,
      tech: false,
      anchorCount: 2,
      followed: false,
      selected: true,
    })
    expect(overlay.stroke).toBe(true)
    expect(overlay.editChrome).toBe(false)
    expect(overlay.appearance.halo).toBe(true)
    expect(overlay.appearance.color).toBe(PATH_INACTIVE)
  })

  it('keeps a stroke in Compose when edit chrome is also on', () => {
    const overlay = pathOverlay({
      playMode: false,
      workspaceMode: 'compose',
      hidden: false,
      tech: false,
      anchorCount: 3,
      followed: true,
      selected: true,
    })
    expect(overlay.stroke).toBe(true)
    expect(overlay.editChrome).toBe(true)
    expect(overlay.appearance.color).toBe(PATH_FOLLOWED)
    expect(overlay.appearance.halo).toBe(true)
  })

  it('draws no polyline for zero or one anchor and keeps edit chrome in Compose', () => {
    const empty = pathOverlay({
      playMode: false,
      workspaceMode: 'compose',
      hidden: false,
      tech: false,
      anchorCount: 0,
      followed: false,
      selected: false,
    })
    expect(empty.stroke).toBe(false)
    expect(empty.editChrome).toBe(false)

    const one = pathOverlay({
      playMode: false,
      workspaceMode: 'compose',
      hidden: false,
      tech: false,
      anchorCount: 1,
      followed: false,
      selected: false,
    })
    expect(one.stroke).toBe(false)
    expect(one.editChrome).toBe(true)
  })

  it('hides stroke and chrome when hidden, playing, visualizing, or in tech mode', () => {
    const base = {
      hidden: false,
      tech: false,
      anchorCount: 2,
      followed: false,
      selected: false,
    }
    expect(pathOverlay({ ...base, playMode: true, workspaceMode: 'compose' }).stroke).toBe(false)
    expect(pathOverlay({ ...base, playMode: false, workspaceMode: 'visualize' }).stroke).toBe(false)
    expect(
      pathOverlay({ ...base, playMode: false, workspaceMode: 'build', hidden: true }).stroke,
    ).toBe(false)
    expect(pathOverlay({ ...base, playMode: false, workspaceMode: 'build', tech: true }).stroke).toBe(
      false,
    )
  })
})
