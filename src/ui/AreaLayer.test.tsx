// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AreaLayer } from './AreaLayer'
import { useLayoutStore } from '../state/useLayoutStore'
import { freeAreaRect, viewportInsets } from './viewportInsets'

/**
 * The split's chrome measured itself with a ResizeObserver on its own element,
 * but that element is unmounted while single-pane — so the observer never
 * attached to the live node and, once a join detached the node it was watching,
 * it reported 0x0 for good. Every pane's controls collapsed into the same
 * corner, the corner grips went to (-16,-16) and the dividers to zero height:
 * you could not resize, switch, close or split. These read the inline styles
 * the layer computes, which is exactly what broke.
 */
const px = (v: string) => Number.parseFloat(v)

function chrome() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('div[style]'))
  const box = (el: HTMLElement) => ({
    x: px(el.style.left),
    y: px(el.style.top),
    w: px(el.style.width),
    h: px(el.style.height),
  })
  return {
    dividers: nodes.filter((n) => n.style.cursor.endsWith('-resize') && n.style.cursor !== 'nwse-resize').map(box),
    grips: nodes.filter((n) => n.style.cursor === 'nwse-resize').map(box),
    clusters: Array.from(document.querySelectorAll<HTMLElement>('div.pointer-events-auto'))
      .filter((n) => n.querySelector('select') || n.textContent?.includes('Editor'))
      .map((n) => ({ x: px(n.style.left), y: px(n.style.top) })),
  }
}

const insets = () => viewportInsets('design', window.innerWidth, true)
const free = () => freeAreaRect(insets(), window.innerHeight)

afterEach(() => {
  cleanup()
  useLayoutStore.getState().applyPreset('single')
})

describe('AreaLayer', () => {
  it('renders nothing with a single pane', () => {
    useLayoutStore.getState().applyPreset('single')
    render(<AreaLayer />)
    expect(chrome().dividers).toHaveLength(0)
  })

  it('gives the divider a real, grabbable size', () => {
    useLayoutStore.getState().applyPreset('director')
    render(<AreaLayer />)
    const [divider] = chrome().dividers
    expect(divider).toBeDefined()
    // it collapsed to 6x0 — unclickable
    expect(divider.h).toBeGreaterThan(100)
    expect(divider.w).toBe(6)
  })

  it('places each pane cluster in its own pane, not stacked in one corner', () => {
    useLayoutStore.getState().applyPreset('quad')
    render(<AreaLayer />)
    const { clusters } = chrome()
    expect(clusters).toHaveLength(4)
    const positions = new Set(clusters.map((c) => `${c.x},${c.y}`))
    expect(positions.size).toBe(4)
  })

  it('keeps every control inside the free area, clear of the panels', () => {
    useLayoutStore.getState().applyPreset('quad')
    render(<AreaLayer />)
    const f = free()
    const { dividers, grips, clusters } = chrome()
    expect(grips.length).toBeGreaterThan(0)
    for (const c of [...clusters, ...grips.map((g) => ({ x: g.x, y: g.y }))]) {
      expect(c.x).toBeGreaterThanOrEqual(f.x)
      expect(c.y).toBeGreaterThanOrEqual(f.y) // was under the Toolbar at y=6
    }
    for (const g of grips) {
      // the grips sat at the pane's true corner, i.e. under the timeline dock
      expect(g.x + g.w).toBeLessThanOrEqual(f.x + f.w)
      expect(g.y + g.h).toBeLessThanOrEqual(f.y + f.h)
    }
    for (const d of dividers) {
      expect(d.y).toBeGreaterThanOrEqual(f.y)
      expect(d.y + d.h).toBeLessThanOrEqual(f.y + f.h)
      expect(d.x).toBeGreaterThanOrEqual(f.x - 3)
      expect(d.x + d.w).toBeLessThanOrEqual(f.x + f.w + 3)
    }
  })

  it('lets a secondary pane take over as the interactive one', () => {
    useLayoutStore.getState().applyPreset('director')
    const { container } = render(<AreaLayer />)
    const select = container.querySelector('select')!
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value)
    expect(options).toContain('editor')
  })
})
