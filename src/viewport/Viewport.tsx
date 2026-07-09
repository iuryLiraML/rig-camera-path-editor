import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Grid } from '@react-three/drei'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { usePathStore, selectCameraAnchorCount } from '../state/usePathStore'
import {
  activePaneRect,
  leafList,
  rectContains,
  useLayoutStore,
} from '../state/useLayoutStore'
import { useEditorOnly } from '../lib/editorOnly'
import { renderBridge } from '../lib/renderBridge'
import { EditorCamera } from './EditorCamera'
import { SceneObjects } from './SceneObjects'
import { PenTool } from './path/PenTool'
import { InactivePaths, PathEditor } from './path/PathEditor'
import { CinemaCamera } from './rig/CinemaCamera'
import { LookAtTarget } from './rig/LookAtTarget'
import { CameraPreview } from './CameraPreview'
import { PaneCompositor } from './PaneCompositor'
import { isTechMode, ViewModeController } from './RenderPasses'

/** Routes R3F pointer picking into the active pane's rect (identity when single). */
function PointerRouting() {
  const setEvents = useThree((s) => s.setEvents)
  useEffect(() => {
    setEvents({
      compute: (event, state) => {
        const r = activePaneRect(state.size.width, state.size.height)
        state.pointer.set(
          ((event.offsetX - r.x) / r.w) * 2 - 1,
          -((event.offsetY - r.y) / r.h) * 2 + 1,
        )
        state.raycaster.setFromCamera(state.pointer, state.camera)
      },
    })
  }, [setEvents])
  return null
}

/** Exposes the render loop to the video exporter (and R3F internals in dev). */
function RenderBridge() {
  const get = useThree((s) => s.get)
  useEffect(() => {
    const state = get()
    renderBridge.advance = state.advance
    renderBridge.setFrameloop = state.setFrameloop
    if (import.meta.env.DEV) {
      Object.assign(window, { __three: get, __THREE: THREE })
    }
    return () => {
      renderBridge.advance = null
      renderBridge.setFrameloop = null
    }
  }, [get])
  return null
}

function EditorGrid() {
  const ref = useRef<THREE.Mesh>(null)
  useEditorOnly(ref)
  return (
    <Grid
      ref={ref}
      position={[0, 0.001, 0]}
      args={[20, 20]}
      infiniteGrid
      cellSize={0.5}
      sectionSize={2.5}
      cellThickness={0.6}
      sectionThickness={1.1}
      cellColor="#9a9aa0"
      sectionColor="#7d7d85"
      fadeDistance={32}
      fadeStrength={1.6}
    />
  )
}

export function Viewport() {
  const bgColor = useSceneStore((s) => s.bgColor)
  const showGrid = useSceneStore((s) => s.showGrid)
  const lightIntensity = useSceneStore((s) => s.lightIntensity)
  const tool = useEditorStore((s) => s.tool)
  const playMode = useEditorStore((s) => s.playMode)
  const exportSize = useEditorStore((s) => s.exportSize)
  const viewMode = useEditorStore((s) => s.viewMode)
  const tech = isTechMode(viewMode)
  const hasTimeline = usePathStore(selectCameraAnchorCount) >= 2
  const singlePane = useLayoutStore((s) => leafList(s.root).length <= 1)

  const background =
    viewMode === 'depth' ? '#000000' : viewMode === 'normals' ? '#8080ff' : bgColor

  const pointerDownAt = useRef<[number, number]>([0, 0])
  const containerRef = useRef<HTMLDivElement>(null)

  // in split layout, swallow pointerdowns that start outside the active pane so
  // only the interactive pane orbits/selects (others are look-only fixed views)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onDown = (e: PointerEvent) => {
      if (useLayoutStore.getState().paneCount() <= 1) return
      const rect = el.getBoundingClientRect()
      const ar = activePaneRect(rect.width, rect.height)
      if (!rectContains(ar, e.clientX - rect.left, e.clientY - rect.top)) {
        e.stopImmediatePropagation()
        e.preventDefault()
      }
    }
    el.addEventListener('pointerdown', onDown, true)
    return () => el.removeEventListener('pointerdown', onDown, true)
  }, [])

  return (
    <div
      ref={containerRef}
      className="absolute"
      style={
        exportSize
          ? { left: 0, top: 0, width: exportSize[0], height: exportSize[1] }
          : { inset: 0 }
      }
    >
    <Canvas
      shadows="soft"
      dpr={exportSize ? 1 : [1, 2]}
      gl={{ antialias: true }}
      onPointerDown={(e) => {
        pointerDownAt.current = [e.clientX, e.clientY]
      }}
      onPointerMissed={(e) => {
        // deselect on a true click on empty space, not after an orbit drag
        const [x, y] = pointerDownAt.current
        const moved = Math.hypot(e.clientX - x, e.clientY - y)
        const editor = useEditorStore.getState()
        if (moved < 5 && editor.tool === 'select' && !editor.playMode) {
          editor.select(null)
        }
      }}
    >
      <RenderBridge />
      <PointerRouting />
      <ViewModeController />
      <color attach="background" args={[background]} />

      <EditorCamera />

      <ambientLight intensity={0.55} />
      <directionalLight
        position={[4, 7, 4]}
        intensity={lightIntensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-bias={-0.0002}
      />
      {/* soft fill from the opposite side so clay never reads flat-black */}
      <directionalLight position={[-5, 3, -4]} intensity={0.35} />

      <SceneObjects />

      {tool === 'pen' && !playMode && !tech && <PenTool />}
      <InactivePaths />
      <PathEditor />
      <CinemaCamera />
      <LookAtTarget />
      <CameraPreview />
      <PaneCompositor />

      {/* invisible shadow catcher */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <shadowMaterial opacity={0.22} />
      </mesh>

      {showGrid && !playMode && !tech && <EditorGrid />}

      {!playMode && singlePane && (
        <GizmoHelper alignment="bottom-center" margin={[48, hasTimeline ? 296 : 110]}>
          <GizmoViewport
            axisColors={['#f05a5a', '#59c05a', '#4a7dff']}
            labelColor="#ffffff"
            hideNegativeAxes
          />
        </GizmoHelper>
      )}
    </Canvas>
    </div>
  )
}
