import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { writeStaticPose } from '../../lib/autoKey'
import { useRigStore } from '../../state/useRigStore'
import { applyFly, lookAtRotationDeg } from '../../lib/staticCamera'

const LOOK_SENS = 0.0026 // radians per pixel
const BASE_SPEED = 4 // metres per second
const SHIFT_MULT = 3
const MIN_SPEED = 0.3
const MAX_SPEED = 40

/**
 * First-person fly authoring for a static (pathless) camera. Active while
 * looking through the camera: WASD to move, Q/E down/up, Shift to sprint,
 * wheel to change speed. Right-drag looks only in Free — Target locks aim
 * to the look-at handle, so RMB never writes Euler that evaluateStaticPose
 * would ignore. Translation still follows the view. Writes go to
 * `staticPose`; CinemaCamera is a pure function of t.
 */
export function CameraFly() {
  const gl = useThree((s) => s.gl)
  const keys = useRef<Set<string>>(new Set())
  const rmb = useRef(false)
  const yawAcc = useRef(0)
  const pitchAcc = useRef(0)
  const speed = useRef(BASE_SPEED)

  useEffect(() => {
    const el = gl.domElement

    const onContextMenu = (e: Event) => e.preventDefault()
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return
      if (useRigStore.getState().lookAtMode === 'target') return
      rmb.current = true
      yawAcc.current = 0
      pitchAcc.current = 0
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* synthetic pointer */
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!rmb.current) return
      yawAcc.current += e.movementX * LOOK_SENS
      pitchAcc.current += e.movementY * LOOK_SENS
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 2) return
      rmb.current = false
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const next = speed.current * (e.deltaY < 0 ? 1.1 : 0.9)
      speed.current = Math.max(MIN_SPEED, Math.min(MAX_SPEED, next))
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'q' || k === 'e' || k === 'shift') {
        e.preventDefault()
        keys.current.add(k)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())

    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      rmb.current = false
      keys.current.clear()
    }
  }, [gl])

  useFrame((_, delta) => {
    const k = keys.current
    const forward = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0)
    const right = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0)
    const up = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0)
    const yawDelta = rmb.current ? yawAcc.current : 0
    const pitchDelta = rmb.current ? pitchAcc.current : 0
    yawAcc.current = 0
    pitchAcc.current = 0
    if (forward === 0 && right === 0 && up === 0 && yawDelta === 0 && pitchDelta === 0) return

    const rig = useRigStore.getState()
    const aimLocked = rig.lookAtMode === 'target'
    const rotation = aimLocked
      ? lookAtRotationDeg(rig.staticPose.position, rig.target)
      : rig.staticPose.rotation
    const next = applyFly(
      { position: rig.staticPose.position, rotation },
      {
        forward,
        right,
        up,
        yawDelta: aimLocked ? 0 : yawDelta,
        pitchDelta: aimLocked ? 0 : pitchDelta,
        speed: speed.current * (k.has('shift') ? SHIFT_MULT : 1),
        dt: Math.min(0.05, delta),
      },
    )
    if (aimLocked) writeStaticPose({ position: next.position })
    else writeStaticPose(next)
  })

  return null
}
