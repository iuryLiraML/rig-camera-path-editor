import { describe, expect, it } from 'vitest'
import { RANGE_LOOK, RANGE_ROLL, RANGE_UNIT } from '../lib/lanePlot'
import { buildGraphChannels } from './GraphEditor'

const emptyPlot = { curve: [0], range: RANGE_UNIT }

const base = {
  duration: 6,
  progressKeys: [] as [],
  progressPlot: emptyPlot,
  intensityKeys: [] as [],
  intensityPlot: emptyPlot,
  fxParamBag: { fadeIn: [] as [], fadeOut: [] as [], ampPos: [] as [], ampRot: [] as [], freq: [] as [] },
  fxParamPlots: {},
  cameraNoiseEnabled: false,
  fovKeys: [] as [],
  rollKeys: [] as [],
  channelPlots: {
    fov: emptyPlot,
    roll: emptyPlot,
  },
  tracking: false,
}

describe('buildGraphChannels', () => {
  it('includes Free-camera Position and Rotation axes once those tracks exist', () => {
    const channels = buildGraphChannels({
      ...base,
      cameraKind: 'static',
      lookAtMode: 'free',
      axisKeys: {
        staticPosX: [{ id: 'p', time: 0, value: 1 }],
        staticRotY: [{ id: 'r', time: 0.5, value: 45 }],
      },
      axisPlots: {
        staticPosX: { curve: [0.5], range: RANGE_LOOK },
        staticRotY: { curve: [0.5], range: RANGE_ROLL },
      },
    })
    expect(channels.map((channel) => channel.id)).toContain('staticPosX')
    expect(channels.map((channel) => channel.id)).toContain('staticRotY')
    expect(channels.find((channel) => channel.id === 'staticPosX')?.label).toBe(
      'Camera · Position X',
    )
  })

  it('always lists Position axes and Look-At, not empty Rotation', () => {
    const channels = buildGraphChannels({
      ...base,
      cameraKind: 'static',
      axisKeys: {},
      axisPlots: {},
    })
    const ids = channels.map((channel) => channel.id)
    expect(ids).toContain('staticPosX')
    expect(ids).toContain('targetX')
    expect(ids).not.toContain('staticRotY')
    expect(ids).not.toContain('fov')
  })

  it('lists Rotation on a path camera in Free, not Look-At', () => {
    const channels = buildGraphChannels({
      ...base,
      cameraKind: 'path',
      lookAtMode: 'free',
      axisKeys: {},
      axisPlots: {},
    })
    const ids = channels.map((channel) => channel.id)
    expect(ids).toContain('staticRotY')
    expect(ids).not.toContain('staticPosX')
    expect(ids).not.toContain('targetX')
  })
})
