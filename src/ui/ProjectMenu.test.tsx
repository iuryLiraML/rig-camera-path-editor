// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { LeftPanel } from './LeftPanel'

afterEach(cleanup)

describe('project menu', () => {
  it('portals onto document.body so the sidebar overflow cannot clip labels', () => {
    const { container } = render(<LeftPanel />)
    const sidebar = container.firstElementChild as HTMLElement
    expect(sidebar.className).toContain('overflow-hidden')

    const trigger = container.querySelector('button[title="Project menu"]')
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger!)

    const labels = ['New project', 'Reset scene', 'Delete project', 'Settings…']
    for (const label of labels) {
      const item = Array.from(document.body.querySelectorAll('button')).find(
        (button) => button.textContent === label,
      )
      expect(item, label).toBeTruthy()
      expect(sidebar.contains(item!), label).toBe(false)
    }
  })
})
