import { describe, expect, it } from 'vitest'
import {
  clampTimeView,
  formatTimecode,
  FULL_TIME_VIEW,
  MIN_TIME_SPAN,
  panTimeView,
  rulerMarks,
  snapToFrame,
  timeInView,
  timeToFrame,
  timeToX,
  TIMELINE_FPS,
  wheelZoomFactor,
  xToTime,
  zoomAround,
} from './timeView'

describe('clampTimeView', () => {
  it('is the identity for a full shot', () => {
    expect(clampTimeView(0, 1)).toEqual(FULL_TIME_VIEW)
  })

  it('does not let the window run past t=1', () => {
    expect(clampTimeView(0.8, 0.4)).toEqual({ start: 0.6, span: 0.4 })
  })

  it('floors span at MIN_TIME_SPAN so a couple of frames still fill the lane', () => {
    const view = clampTimeView(0.5, 0.001)
    expect(view.span).toBe(MIN_TIME_SPAN)
    expect(view.start).toBeGreaterThanOrEqual(0)
    expect(view.start + view.span).toBeLessThanOrEqual(1)
  })
})

describe('timeToX / xToTime', () => {
  it('is the identity on a full view', () => {
    expect(timeToX(0.4, FULL_TIME_VIEW)).toBeCloseTo(0.4)
    expect(xToTime(0.4, FULL_TIME_VIEW)).toBeCloseTo(0.4)
  })

  it('round-trips inside a zoomed window', () => {
    const view = { start: 0.25, span: 0.5 }
    expect(xToTime(timeToX(0.4, view), view)).toBeCloseTo(0.4)
    expect(timeToX(0.25, view)).toBeCloseTo(0)
    expect(timeToX(0.75, view)).toBeCloseTo(1)
  })
})

describe('zoomAround', () => {
  it('keeps the anchor at the same x when zooming in', () => {
    const next = zoomAround(FULL_TIME_VIEW, 0.5, 0.5)
    expect(next.span).toBeCloseTo(0.5)
    expect(timeToX(0.5, next)).toBeCloseTo(0.5)
    expect(next.start).toBeCloseTo(0.25)
  })

  it('keeps a cursor near the left edge pinned when zooming in', () => {
    const next = zoomAround(FULL_TIME_VIEW, 0.1, 0.5)
    expect(timeToX(0.1, next)).toBeCloseTo(0.1)
  })

  it('returns to a full shot when zooming out from anywhere', () => {
    const zoomed = { start: 0.3, span: 0.4 }
    const next = zoomAround(zoomed, 0.5, 8)
    expect(next).toEqual(FULL_TIME_VIEW)
  })
})

describe('panTimeView', () => {
  it('shifts start and clamps at the end of the shot', () => {
    expect(panTimeView({ start: 0.2, span: 0.4 }, 0.1).start).toBeCloseTo(0.3)
    expect(panTimeView({ start: 0.2, span: 0.4 }, 0.1).span).toBeCloseTo(0.4)
    expect(panTimeView({ start: 0.5, span: 0.4 }, 0.9).start).toBeCloseTo(0.6)
  })
})

describe('timeInView', () => {
  it('rejects times outside the window', () => {
    const view = { start: 0.4, span: 0.2 }
    expect(timeInView(0.5, view)).toBe(true)
    expect(timeInView(0.1, view)).toBe(false)
  })
})

describe('rulerMarks', () => {
  it('places a second mark on a 6 s full view', () => {
    const marks = rulerMarks(6, FULL_TIME_VIEW, 30)
    const labeled = marks.filter((m) => m.label)
    expect(labeled.map((m) => m.label)).toContain('0s')
    expect(labeled.map((m) => m.label)).toContain('3s')
    expect(labeled.every((m) => m.label?.endsWith('s'))).toBe(true)
  })

  it('switches to seconds:frames when the window is a couple of seconds', () => {
    const marks = rulerMarks(6, { start: 0, span: 2 / 6 }, 30)
    const labels = marks.map((m) => m.label).filter(Boolean) as string[]
    expect(labels.some((label) => label.includes(':'))).toBe(true)
  })

  it('counts every frame when zoomed to a handful of frames', () => {
    // 8 frames of a 6 s / 30 fps shot
    const marks = rulerMarks(6, { start: 0, span: 8 / 180 }, 30)
    const labeled = marks.filter((m) => m.label)
    expect(labeled.length).toBeGreaterThanOrEqual(5)
    expect(labeled.some((m) => m.label === '0:00' || m.label === '0s')).toBe(true)
    expect(labeled.some((m) => m.label === '0:01' || m.label === '0:02')).toBe(true)
  })
})

describe('formatTimecode', () => {
  it('writes seconds:frames at 30 fps', () => {
    expect(formatTimecode(0, 6, 30)).toBe('0:00')
    expect(formatTimecode(1, 6, 30)).toBe('6:00')
    expect(timeToFrame(0.5, 6, 30)).toBe(90)
    expect(formatTimecode(0.5, 6, 30)).toBe('3:00')
  })
})

describe('snapToFrame', () => {
  it('lands on the 30 fps grid', () => {
    expect(snapToFrame(0.5, 6, 30)).toBeCloseTo(0.5)
    expect(snapToFrame(1 / 180, 6, 30)).toBeCloseTo(1 / 180)
    const snapped = snapToFrame(0.5 / 180, 6, 30)
    expect(snapped === 0 || snapped === 1 / 180).toBe(true)
  })
})

describe('wheelZoomFactor', () => {
  it('zooms out when scrolling down', () => {
    expect(wheelZoomFactor(80)).toBeGreaterThan(1)
    expect(wheelZoomFactor(-80)).toBeLessThan(1)
  })
})

describe('TIMELINE_FPS', () => {
  it('matches the MP4 export rate', () => {
    expect(TIMELINE_FPS).toBe(30)
  })
})
