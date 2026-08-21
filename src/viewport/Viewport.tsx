import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Grid } from '@react-three/drei'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import {
  computeRects,
  leafList,
  paneAt,
  useLayoutStore,
} from '../state/useLayoutStore'
import { useEditorOnly } from '../lib/editorOnly'
import { isPathEditing, isSceneEditing } from '../lib/workspaceChrome'
import { FOOTER_ROW_HEIGHT, GUTTER, useViewportInsets } from '../ui/viewportInsets'
import { renderBridge } from '../lib/renderBridge'
import { EditorCamera } from './EditorCamera'
import { SceneObjects } from './SceneObjects'
import { PenTool } from './path/PenTool'
import { InactivePaths, PathEditor } from './path/PathEditor'
import { CinemaCamera, cinemaCameraRef } from './rig/CinemaCamera'
import { CameraFly } from './rig/CameraFly'
import { CameraRig } from './rig/CameraRig'
import { LookAtTarget } from './rig/LookAtTarget'
import { useRigStore } from '../state/useRigStore'
import { CameraPreview } from './CameraPreview'
import { PaneCompositor } from './PaneCompositor'
import { isTechMode, ViewModeController } from './RenderPasses'
import { filterViewportHits } from '../lib/viewportPick'
import { isSpatialView, spatialCameras } from './spatialViews'
import {
  createViewportGradientTexture,
  updateViewportGradientTexture,
  VIEWPORT_BG_DEFAULT_TOP,
} from './viewportBackground'

/** Routes R3F pointer picking into the pane under the cursor. */
function PointerRouting() {
  const setEvents = useThree((s) => s.setEvents)
  useEffect(() => {
    setEvents({
      compute: (event, state) => {
        const size = state.size
        const leaf = paneAt(event.offsetX, event.offsetY, size.width, size.height)
        const rects = computeRects(useLayoutStore.getState().root, {
          x: 0,
          y: 0,
          w: size.width,
          h: size.height,
        }).leaves
        const r = (leaf && rects.get(leaf.id)) ?? { x: 0, y: 0, w: size.width, h: size.height }
        state.pointer.set(
          ((event.offsetX - r.x) / Math.max(1, r.w)) * 2 - 1,
          -((event.offsetY - r.y) / Math.max(1, r.h)) * 2 + 1,
        )
        let cam = state.camera
        if (leaf && isSpatialView(leaf.view)) cam = spatialCameras[leaf.view]
        else if (leaf?.view === 'camera' && cinemaCameraRef.current) cam = cinemaCameraRef.current
        state.raycaster.params.Line = { threshold: 0.03 }
        state.raycaster.params.Points = { threshold: 0.08 }
        state.raycaster.setFromCamera(state.pointer, cam)
      },
      filter: (hits) => filterViewportHits(hits),
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

function ViewportBackground({ color }: { color: string }) {
  const scene = useThree((s) => s.scene)
  const viewMode = useEditorStore((s) => s.viewMode)
  const texture = useMemo(() => createViewportGradientTexture(VIEWPORT_BG_DEFAULT_TOP), [])

  useEffect(() => () => texture.dispose(), [texture])

  useEffect(() => {
    if (viewMode === 'depth') {
      scene.background = new THREE.Color('#000000')
      return
    }
    if (viewMode === 'normals') {
      scene.background = new THREE.Color('#8080ff')
      return
    }
    updateViewportGradientTexture(texture, color)
    scene.background = texture
  }, [color, scene, texture, viewMode])

  return null
}

function ignoreRaycast() {
  // Floor helpers must not count as a hit, or empty-space clicks never miss.
}

function EditorGrid() {
  const ref = useRef<THREE.Mesh>(null)
  useEditorOnly(ref)
  return (
    <Grid
      ref={ref}
      raycast={ignoreRaycast}
      position={[0, 0.025, 0]}
      args={[20, 20]}
      infiniteGrid
      cellSize={0.5}
      sectionSize={2.5}
      cellThickness={0.7}
      sectionThickness={1.2}
      cellColor="#9a9aa0"
      sectionColor="#7d7d85"
      // fadeFrom 0 = origin: pulling the camera back used to wipe the whole
      // grid (default is camera, and fadeDistance 32 sat inside a typical orbit).
      fadeFrom={0}
      fadeDistance={180}
      fadeStrength={0.7}
    />
  )
}

export function Viewport() {
  const bgColor = useSceneStore((s) => s.bgColor)
  const showGrid = useSceneStore((s) => s.showGrid)
  const lightIntensity = useSceneStore((s) => s.lightIntensity)
  const tool = useEditorStore((s) => s.tool)
  const playMode = useEditorStore((s) => s.playMode)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const cameraView = useEditorStore((s) => s.cameraView)
  const staticCamera = useRigStore((s) => s.cameraKind === 'static')
  const exportSize = useEditorStore((s) => s.exportSize)
  const viewMode = useEditorStore((s) => s.viewMode)
  const tech = isTechMode(viewMode)
  const singlePane = useLayoutStore((s) => leafList(s.root).length <= 1)
  const insets = useViewportInsets()

  const pointerDownAt = useRef<[number, number]>([0, 0])

  return (
    <div
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
      <ViewportBackground color={bgColor} />

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

      {tool === 'pen' && isPathEditing(playMode, workspaceMode) && !tech && <PenTool />}
      <InactivePaths />
      <PathEditor />
      <CinemaCamera />
      {staticCamera && <CameraRig />}
      {cameraView && staticCamera && <CameraFly />}
      <LookAtTarget />
      <CameraPreview />
      <PaneCompositor />

      {/* invisible shadow catcher */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow raycast={ignoreRaycast}>
        <planeGeometry args={[80, 80]} />
        <shadowMaterial opacity={0.22} />
      </mesh>

      {showGrid && !playMode && !tech && <EditorGrid />}

      {!playMode && !cameraView && singlePane && isSceneEditing(playMode, workspaceMode) && (
        <GizmoHelper
          alignment="bottom-left"
          margin={[
            Math.max(28, insets.left + 28),
            Math.max(
              40,
              insets.bottom +
                GUTTER +
                (workspaceMode === 'compose' ? FOOTER_ROW_HEIGHT + GUTTER : 0) +
                56,
            ),
          ]}
        >
          <GizmoViewport
            scale={22}
            axisHeadScale={0.85}
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
