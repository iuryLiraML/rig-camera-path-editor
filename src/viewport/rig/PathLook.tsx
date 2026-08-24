import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { nudgeFov } from '../../lib/autoKey'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'

const FOV_STEP = 2
const FOV_FINE = 0.4

/**
 * Look-through authoring for a path camera. Position stays on the path (a
 * function of t); the wheel changes FOV from the evaluated playhead value.
 * Keys write only when that channel already has a track.
 */
export function PathLook() {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const el = gl.domElement
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (useRigStore.getState().playing || useEditorStore.getState().playMode) return
      const step = e.shiftKey ? FOV_FINE : FOV_STEP
      nudgeFov(e.deltaY < 0 ? -step : step)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gl])

  return null
}
