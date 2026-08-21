import { describe, expect, it } from 'vitest'
import { RANGE_LOOK, RANGE_ROLL, RANGE_UNIT } from '../lib/lanePlot'
import { buildGraphChannels } from './GraphEditor'

const emptyPlot = { curve: [0], range: RANGE_UNIT }

describe('buildGraphChannels', () => {
  it('includes Free-camera Position and Rotation once those tracks exist', () => {
    const channels = buildGraphChannels({
      duration: 6,
      progressKeys: [],
      progressPlot: emptyPlot,
      intensityKeys: [],
      intensityPlot: emptyPlot,
      fxParamBag: { fadeIn: [], fadeOut: [], ampPos: [], ampRot: [], freq: [] },
      fxParamPlots: {},
      cameraNoiseEnabled: false,
      fovKeys: [],
      rollKeys: [],
      targetKeys: [],
      lookOffsetKeys: [],
      channelPlots: {
        fov: emptyPlot,
        roll: emptyPlot,
        target: { curve: [0], range: RANGE_LOOK },
        lookOffset: { curve: [0], range: RANGE_LOOK },
      },
      tracking: false,
      staticPosKeys: [{ id: 'p', time: 0, value: [1, 2, 3] }],
      staticRotKeys: [{ id: 'r', time: 0.5, value: [0, 45, 0] }],
      staticPosPlot: { curve: [0.5], range: RANGE_LOOK },
      staticRotPlot: { curve: [0.5], range: RANGE_ROLL },
    })
    expect(channels.map((channel) => channel.id)).toContain('staticPos')
    expect(channels.map((channel) => channel.id)).toContain('staticRot')
    expect(channels.find((channel) => channel.id === 'staticPos')?.label).toBe('Camera · Position')
  })

  it('omits Free-camera pose channels when they have no keys', () => {
    const channels = buildGraphChannels({
      duration: 6,
      progressKeys: [],
      progressPlot: emptyPlot,
      intensityKeys: [],
      intensityPlot: emptyPlot,
      fxParamBag: { fadeIn: [], fadeOut: [], ampPos: [], ampRot: [], freq: [] },
      fxParamPlots: {},
      cameraNoiseEnabled: false,
      fovKeys: [],
      rollKeys: [],
      targetKeys: [],
      lookOffsetKeys: [],
      channelPlots: {
        fov: emptyPlot,
        roll: emptyPlot,
        target: { curve: [0], range: RANGE_LOOK },
        lookOffset: { curve: [0], range: RANGE_LOOK },
      },
      tracking: false,
      staticPosKeys: [],
      staticRotKeys: [],
    })
    expect(channels.map((channel) => channel.id)).not.toContain('staticPos')
    expect(channels.map((channel) => channel.id)).not.toContain('staticRot')
  })
})
