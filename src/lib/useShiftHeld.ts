import { useEffect, useState } from 'react'

/** True while Shift is held. Used so Shift+click can multi-select instead of panning. */
export function useShiftHeld() {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setHeld(false)
    }
    const clear = () => setHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])
  return held
}
