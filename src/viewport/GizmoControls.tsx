import { TransformControls } from '@react-three/drei'
import { type ThreeEvent } from '@react-three/fiber'
import { useRef, type ComponentProps } from 'react'
import type { Group } from 'three'
import { useEditorOnly } from '../lib/editorOnly'

type GizmoControlsProps = ComponentProps<typeof TransformControls>

/**
 * W/E/R gizmo that R3F can actually pick. drei's TransformControls only
 * listens on the canvas; wrapping it in a tagged group puts the arrows in
 * `events.filter` so a mesh behind them cannot steal the pointer.
 */
export function GizmoControls(props: GizmoControlsProps) {
  const rootRef = useRef<Group>(null)
  useEditorOnly(rootRef)
  return (
    <group
      ref={rootRef}
      userData={{ pickKind: 'gizmo' }}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        if (e.button !== 0) return
        e.stopPropagation()
      }}
    >
      <TransformControls {...props} />
    </group>
  )
}
