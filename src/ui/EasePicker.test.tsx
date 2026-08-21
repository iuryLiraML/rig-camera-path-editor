// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EasePicker } from './EasePicker'

afterEach(() => {
  cleanup()
})

describe('EasePicker', () => {
  it('opens an upward menu instead of a native select', () => {
    const seen: string[] = []
    const { container, getByTitle } = render(
      <EasePicker value="linear" onChange={(ease) => seen.push(ease)} />,
    )
    expect(container.querySelector('select')).toBeNull()
    fireEvent.click(getByTitle('Constant speed — mechanical, technical moves'))
    expect(container.textContent).toContain('Ease In-Out')
    fireEvent.click(getByTitle('Natural arrival — decelerates into place'))
    expect(seen).toEqual(['cubicOut'])
  })
})
