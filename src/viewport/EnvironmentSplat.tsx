import { useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { useEditorStore } from '../state/useEditorStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { showEnvironmentSplat, SPLAT_INRIA_TO_Y_UP, type EnvironmentFormat } from '../lib/environment'
import { attachEnvironmentPickProxy } from '../lib/splatPick'
import { pickKindOf } from '../lib/viewportPick'
import { useSceneStore } from '../state/useSceneStore'
import { GizmoControls } from './GizmoControls'
import { isSceneEditing } from '../lib/workspaceChrome'
import { isTechMode } from './RenderPasses'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

type SplatViewer = THREE.Object3D & {
  dispose?: () => void | Promise<void>
  addSplatScene?: (url: string, opts?: Record<string, unknown>) => Promise<unknown>
  splatMesh?: THREE.Object3D & {
    getSplatTree?: () => unknown
    onSplatTreeReady?: (cb: () => void) => void
  }
}

/**
 * Photoreal palco in the clay camera (E3). Loader: @mkkellogg/gaussian-splats-3d DropInViewer.
 * Stay resident across Clay/Look export toggles — hide with `visible`, do not dispose.
 * Mount the viewer only after the group exists (buffer + environmentId), or the first
 * effect run sees a null ref and never loads.
 */
export function EnvironmentSplat() {
  const environmentId = useEnvironmentStore((s) => s.environmentId)
  const buffer = useEnvironmentStore((s) => s.liveBuffer)
  const format = useEnvironmentStore((s) => s.liveFormat)
  if (!environmentId || !buffer || !format) return null
  return <EnvironmentSplatLoaded buffer={buffer} format={format} />
}

function EnvironmentSplatLoaded({
  buffer,
  format,
}: {
  buffer: ArrayBuffer
  format: EnvironmentFormat
}) {
  const transform = useEnvironmentStore((s) => s.environmentTransform)
  const viewMode = useEditorStore((s) => s.viewMode)
  const recording = useEditorStore((s) => s.recording)
  const hidden = useEditorStore((s) => s.hiddenIds.includes('env'))
  const selected = useEditorStore((s) => s.selection === 'env')
  const tool = useEditorStore((s) => s.tool)
  const playMode = useEditorStore((s) => s.playMode)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const gizmoMode = useEditorStore((s) => s.gizmoMode)
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const gridSize = useEditorStore((s) => s.gridSize)
  const visible = Boolean(!hidden && showEnvironmentSplat(viewMode, recording))
  const groupRef = useRef<THREE.Group>(null)
  const [basis, setBasis] = useState<THREE.Group | null>(null)
  const viewerRef = useRef<SplatViewer | null>(null)

  useLayoutEffect(() => {
    if (!basis) return
    let cancelled = false
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' }),
    )

    void import('@mkkellogg/gaussian-splats-3d')
      .then((mod) => {
        if (cancelled) return
        const lib = mod as {
          DropInViewer: new (opts: Record<string, unknown>) => SplatViewer
          SceneFormat: { Ply: number; Splat: number }
          SceneRevealMode: { Instant: number }
        }
        const viewer = new lib.DropInViewer({
          gpuAcceleratedSort: false,
          sharedMemoryForWorkers: false,
          integerBasedSort: false,
          dynamicScene: true,
          sceneRevealMode: lib.SceneRevealMode.Instant,
        })
        viewer.name = 'drop-in-viewer'
        disableRaycast(viewer)
        viewerRef.current = viewer
        basis.add(viewer)
        return viewer.addSplatScene?.(url, {
          format: format === 'splat' ? lib.SceneFormat.Splat : lib.SceneFormat.Ply,
          showLoadingUI: false,
          progressiveLoad: false,
        }).then(() => {
          if (cancelled || !viewer.splatMesh) return
          attachEnvironmentPickProxy(viewer.splatMesh)
        })
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Environment splat failed to load', error)
        useSceneStore.getState().showNotice(
          'Environment splat failed to load. The file may be ASCII PLY or not a Gaussian splat.',
        )
      })
      .finally(() => {
        URL.revokeObjectURL(url)
      })

    return () => {
      cancelled = true
      const viewer = viewerRef.current
      viewerRef.current = null
      if (viewer) {
        basis.remove(viewer)
        void Promise.resolve(viewer.dispose?.()).catch(() => undefined)
      }
    }
  }, [basis, buffer, format])

  const editing = isSceneEditing(playMode, workspaceMode)
  const tech = isTechMode(viewMode)

  return (
    <group
      ref={groupRef}
      name="environment-splat"
      visible={visible}
      userData={{ pickKind: 'env', pickId: 'env' }}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        const editor = useEditorStore.getState()
        if (editor.cameraView) return
        if (editor.tool !== 'select' || !editing || e.button !== 0) return
        if (
          e.intersections.some((hit) => {
            const kind = pickKindOf(hit.object)
            return kind === 'gizmo' || kind === 'target' || kind === 'object'
          })
        ) {
          return
        }
        editor.select('env')
        if (selected) return
        e.stopPropagation()
      }}
      position={transform.position}
      rotation={[transform.rotation[0] * DEG, transform.rotation[1] * DEG, transform.rotation[2] * DEG]}
      scale={transform.scale}
    >
      <group ref={setBasis} name="splat-inria-basis" rotation={SPLAT_INRIA_TO_Y_UP} />
      {selected && tool === 'select' && editing && !tech && (
        <GizmoControls
          object={groupRef as React.RefObject<THREE.Group>}
          mode={gizmoMode}
          size={0.85}
          translationSnap={snapEnabled ? gridSize : undefined}
          onObjectChange={() => {
            const g = groupRef.current
            if (!g) return
            useEnvironmentStore.getState().setEnvironmentTransform({
              position: g.position.toArray() as [number, number, number],
              rotation: [g.rotation.x * RAD, g.rotation.y * RAD, g.rotation.z * RAD],
              scale: g.scale.toArray() as [number, number, number],
            })
          }}
        />
      )}
    </group>
  )
}

function disableRaycast(root: THREE.Object3D) {
  root.traverse((node) => {
    if (node === root) return
    node.raycast = () => {}
  })
}
