// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TutorialInputHints } from './TutorialInputHints'

afterEach(cleanup)

describe('TutorialInputHints', () => {
  it('renders mouse gestures and prominent keyboard keys', () => {
    render(
      <TutorialInputHints hints={[
        { label: 'Pan', input: 'mouse-middle', keys: ['Shift'], gesture: 'Drag' },
        { label: 'Open Help', input: 'keyboard', keys: ['?'], gesture: 'Shortcuts' },
      ]} />,
    )

    expect(screen.getByRole('region', { name: 'Input controls' }).textContent).toContain('Pan')
    expect(screen.getByText('Shift').tagName).toBe('KBD')
    expect(screen.getByText('?').tagName).toBe('KBD')
    expect(screen.getByText('Drag')).toBeTruthy()
  })

  it('does not render an empty legend', () => {
    const { container } = render(<TutorialInputHints hints={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
