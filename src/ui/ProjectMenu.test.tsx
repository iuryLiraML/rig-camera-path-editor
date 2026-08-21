// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'
import { ProjectChip } from './ProjectChip'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ workspaceMode: 'build', showOutliner: false })
})

describe('project menu', () => {
  it('portals onto document.body so the chip cannot clip labels', () => {
    useEditorStore.setState({ workspaceMode: 'build', showOutliner: true })
    const { container } = render(<ProjectChip />)
    const chip = container.firstElementChild as HTMLElement

    const trigger = container.querySelector('button[title="Project menu"]')
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger!)

    const labels = ['New project', 'Reset scene', 'Delete project', 'Settings…']
    for (const label of labels) {
      const item = Array.from(document.body.querySelectorAll('button')).find(
        (button) => button.textContent === label,
      )
      expect(item, label).toBeTruthy()
      expect(chip.contains(item!), label).toBe(false)
    }
  })
})
