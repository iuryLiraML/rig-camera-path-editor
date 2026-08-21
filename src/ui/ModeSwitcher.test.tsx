// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { viewportInsets } from './viewportInsets'
import { ModeSwitcher } from './ModeSwitcher'

afterEach(() => cleanup())

describe('ModeSwitcher', () => {
  it('centres on the free area, not the window, so it clears the Director column', () => {
    const { container } = render(<ModeSwitcher />)
    const root = container.firstElementChild as HTMLElement
    const expected = viewportInsets('build', window.innerWidth, false, window.innerHeight)
    expect(root.style.left).toBe(`${expected.centre}px`)
    expect(root.className).toContain('-translate-x-1/2')
    expect(root.className).not.toContain('left-1/2')
  })
})
