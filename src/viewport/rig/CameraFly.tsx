import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { detachCinemaToStatic } from '../../lib/addStaticCamera'
import { evaluatedStaticPose, nudgeFov, writeStaticPose } from '../../lib/autoKey'
import { applyFly } from '../../lib/staticCamera'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore } from '../../state/useSceneStore'

const LOOK_SENS = 0.0026 // radians per pixel
const BASE_SPEED = 4 // metres per second
const SHIFT_MULT = 3
const MIN_SPEED = 0.3
const MAX_SPEED = 40

function flyIntent(key: string): string | null {
  if (key === 'ArrowUp' || key === 'w' || key === 'W') return 'w'
  if (key === 'ArrowDown' || key === 's' || key === 'S') return 's'
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'a'
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'd'
  const k = key.toLowerCase()
  if (k === 'q' || k === 'e' || k === 'shift') return k
  return null
}

function prepareFly() {
  const rig = useRigStore.getState()
  if (rig.cameraKind !== 'static') {
    detachCinemaToStatic({ stayInView: true })
    useRigStore.getState().setLookAtMode('free')
    useSceneStore.getState().showNotice('Flying a free camera. The path stays in the project.')
  } else if (rig.lookAtMode === 'target') {
    rig.setLookAtMode('free')
  }
}

/**
 * Blender-style walk/fly while looking through any cinema camera. WASD or
 * arrows move, Q/E down/up, Shift sprints, LMB or RMB looks, wheel changes
 * speed (Shift+wheel nudges FOV). A path camera detaches on the first move
 * so CinemaCamera stays a pure function of t.
 */
export function CameraFly() {
  const gl = useThree((s) => s.gl)
  const keys = useRef<Set<string>>(new Set())
  const looking = useRef(false)
  const yawAcc = useRef(0)
  const pitchAcc = useRef(0)
  const speed = useRef(BASE_SPEED)

  useEffect(() => {
    const el = gl.domElement

    const onContextMenu = (e: Event) => e.preventDefault()
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      looking.current = true
      yawAcc.current = 0
      pitchAcc.current = 0
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* synthetic pointer */
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!looking.current) return
      yawAcc.current += e.movementX * LOOK_SENS
      pitchAcc.current += e.movementY * LOOK_SENS
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      looking.current = false
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (useRigStore.getState().playing || useEditorStore.getState().playMode) return
      if (e.shiftKey) {
        const step = 0.4
        nudgeFov(e.deltaY < 0 ? -step : step)
        return
      }
      const next = speed.current * (e.deltaY < 0 ? 1.1 : 0.9)
      speed.current = Math.max(MIN_SPEED, Math.min(MAX_SPEED, next))
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const intent = flyIntent(e.key)
      if (!intent) return
      e.preventDefault()
      keys.current.add(intent)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const intent = flyIntent(e.key)
      if (intent) keys.current.delete(intent)
    }

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
      looking.current = false
      keys.current.clear()
    }
  }, [gl])

  useFrame((_, delta) => {
    const k = keys.current
    const forward = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0)
    const right = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0)
    const up = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0)
    const yawDelta = looking.current ? yawAcc.current : 0
    const pitchDelta = looking.current ? pitchAcc.current : 0
    yawAcc.current = 0
    pitchAcc.current = 0
    if (forward === 0 && right === 0 && up === 0 && yawDelta === 0 && pitchDelta === 0) return

    const editor = useEditorStore.getState()
    if (useRigStore.getState().playing || editor.playMode) return
    prepareFly()
    const rig = useRigStore.getState()
    const live = evaluatedStaticPose(rig)
    const next = applyFly(live, {
      forward,
      right,
      up,
      yawDelta,
      pitchDelta,
      speed: speed.current * (k.has('shift') ? SHIFT_MULT : 1),
      dt: Math.min(0.05, delta),
    })
    writeStaticPose(next)
  })

  return null
}
