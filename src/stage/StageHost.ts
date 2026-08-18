import {
  AppBase,
  AppOptions,
  Asset,
  CameraComponentSystem,
  Color,
  ContainerHandler,
  Entity,
  FILLMODE_NONE,
  GSplatComponentSystem,
  GSplatHandler,
  LightComponentSystem,
  Mesh,
  MeshInstance,
  Mouse,
  PRIMITIVE_LINESTRIP,
  Quat,
  RESOLUTION_AUTO,
  RenderComponentSystem,
  StandardMaterial,
  TextureHandler,
  Vec3,
  createGraphicsDevice,
  type GraphicsDevice,
} from 'playcanvas'
import { DEFAULT_EASE } from '../lib/easing'
import {
  evaluateCinemaPose,
  type CinemaChannels,
  type CinemaPathInput,
} from '../lib/evaluateCinemaPose'
import { synthesizeQuarterOrbitPath } from '../lib/synthesizeDemoPath'
import { makeAnchor, type PathAnchor } from '../state/usePathStore'
import type { Vec3 as RigVec3 } from '../state/useSceneStore'
import { DEMO_LOCATION } from './demoConfig'
import { locationTransform } from './locationSidecar'
import {
  PREVIEW_SPLAT_BUDGET,
  type ExportManifest,
  type QualityMode,
} from './exportManifest'
import {
  aabbFromCenterSize,
  clientToCanvasPixels,
  horizontalDistanceSq,
  intersectRayAabb,
  intersectRayYPlane,
  type Ray3,
  type RayHit,
} from './pickMath'
import { samplePathPolyline } from './pathOverlayMath'

export type StageViewMode = 'orbit' | 'camera'
export type StageBootMode = 'demo' | 'blank'
/** Select orbits (and can drag anchors); Pen click-places corners on the pick stack. */
export type StageEditTool = 'select' | 'pen'

export type StageHitKind = 'prop' | 'drawing-plane'

export type StageHit = {
  kind: StageHitKind
  point: RigVec3
  distance: number
  entityName?: string
}

export type StageScreenPoint = {
  /** CSS client X (e.g. PointerEvent.clientX) */
  clientX: number
  /** CSS client Y (e.g. PointerEvent.clientY) */
  clientY: number
}

export type StageHostOptions = {
  canvas: HTMLCanvasElement
  mode: StageBootMode
  onReady?: () => void
  onError?: (error: Error) => void
}

export class WarmPathTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number) {
    super(`warmPath timed out after ${timeoutMs}ms`)
    this.name = 'WarmPathTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * PlayCanvas StageHost — spike surface from ARCHITECTURE-GS §4.1.
 * Owns graphics device, scene graph stubs, and disposal. React must not touch
 * PlayCanvas internals outside this module.
 */
export class StageHost {
  readonly app: AppBase
  readonly device: GraphicsDevice
  private readonly canvas: HTMLCanvasElement
  private cameraEntity: Entity
  private lightEntity: Entity
  private spaceEntity: Entity | null = null
  private propEntity: Entity | null = null
  private drawingPlaneEntity: Entity | null = null
  private drawingPlaneY = 0
  private orbitYaw = 0.4
  private orbitPitch = 0.35
  private orbitDistance = 18
  private focus = new Vec3(0, 1, 0)
  private dragging = false
  private lastX = 0
  private lastY = 0
  private disposed = false
  private viewMode: StageViewMode = 'orbit'
  private editTool: StageEditTool = 'select'
  private objectBlockingVisible = true
  private cinemaPosition = new Vec3(0, 1.6, 4)
  private cinemaRotation = new Quat()
  private cinemaFov = 50
  /** Normalized timeline pose — animation must stay a pure function of this. */
  private time = 0
  private qualityMode: QualityMode = 'preview'
  private qualityManifest: ExportManifest | null = null
  /** Active cinema path (drawn or synthesized fallback). */
  private pathInput: CinemaPathInput = { anchors: [], closed: false, rounding: 0.8 }
  private channels: CinemaChannels = {
    progressKeys: [],
    fovKeys: [],
    rollKeys: [],
    targetKeys: [],
    fov: 50,
    roll: 0,
    target: [0, 1, 0],
    ease: DEFAULT_EASE,
    lookAtMode: 'target',
  }
  /** World-radius threshold for selecting an existing anchor to drag (select tool). */
  private readonly anchorPickRadius = 0.55
  private draggingAnchorId: string | null = null
  private selectedAnchorId: string | null = null
  private onPathChange: ((path: CinemaPathInput) => void) | null = null
  /** When set, resize uses exact export pixels (no DPR) for manifesto parity. */
  private exportPixelSize: { width: number; height: number } | null = null
  /** Editor-only path polyline + anchors (hidden in Camera / during export capture). */
  private pathOverlayRoot: Entity | null = null
  private pathLineEntity: Entity | null = null
  private pathAnchorsRoot: Entity | null = null
  private pathLineMesh: Mesh | null = null
  private pathLineMaterial: StandardMaterial | null = null
  private pathAnchorMaterial: StandardMaterial | null = null
  private pathAnchorSelectedMaterial: StandardMaterial | null = null

  private constructor(app: AppBase, device: GraphicsDevice, canvas: HTMLCanvasElement) {
    this.app = app
    this.device = device
    this.canvas = canvas
    this.cameraEntity = new Entity('editor-camera')
    this.lightEntity = new Entity('key-light')
  }

  static async create(options: StageHostOptions): Promise<StageHost> {
    const { canvas, mode, onReady, onError } = options

    let device: GraphicsDevice
    try {
      device = await createGraphicsDevice(canvas, {
        deviceTypes: ['webgpu'],
        antialias: false,
      })
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      onError?.(err)
      throw err
    }

    if (!device.isWebGPU) {
      device.destroy()
      const err = new Error('WebGPU device was not created')
      onError?.(err)
      throw err
    }

    const createOptions = new AppOptions()
    createOptions.graphicsDevice = device
    createOptions.mouse = new Mouse(canvas)
    createOptions.componentSystems = [
      RenderComponentSystem,
      CameraComponentSystem,
      LightComponentSystem,
      GSplatComponentSystem,
    ]
    createOptions.resourceHandlers = [TextureHandler, ContainerHandler, GSplatHandler]

    const app = new AppBase(canvas)
    app.init(createOptions)
    app.setCanvasFillMode(FILLMODE_NONE)
    app.setCanvasResolution(RESOLUTION_AUTO)

    const host = new StageHost(app, device, canvas)
    host.setupScene()
    host.bindOrbitInput()

    app.start()
    host.resize()

    try {
      if (mode === 'demo') {
        await host.loadDemoLocation()
        host.addClayProp()
      } else {
        host.addDrawingPlane(0, true)
        host.addClayProp()
        // Blank: short default path so setTime uses the same evaluators as Demo.
        host.installSynthesizedPath([0, 1.6, 4], [0, 0.5, 0])
      }
      host.evaluateCinemaAt(host.time)
      host.applyOrbitCamera()
      onReady?.()
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      onError?.(err)
      host.dispose()
      throw err
    }

    return host
  }

  private setupScene() {
    this.app.scene.ambientLight = new Color(0.35, 0.35, 0.38)
    this.applyPreviewGsplatParams()

    this.cameraEntity.addComponent('camera', {
      clearColor: new Color(0.94, 0.78, 0.77),
      fov: 50,
      nearClip: 0.05,
      farClip: 2000,
    })
    this.app.root.addChild(this.cameraEntity)

    this.lightEntity.addComponent('light', {
      type: 'directional',
      color: new Color(1, 1, 1),
      intensity: 1.1,
      castShadows: false,
    })
    this.lightEntity.setLocalEulerAngles(45, 30, 0)
    this.app.root.addChild(this.lightEntity)
    this.setupPathOverlay()
  }

  /** Soft editor overlays — grayscale corners + accent selection, not lit like scene props. */
  private setupPathOverlay() {
    const lineMat = new StandardMaterial()
    lineMat.useLighting = false
    // Soft accent polyline (#3b82f6) — readable on splat without dominating it
    lineMat.emissive = new Color(0.23, 0.51, 0.96)
    lineMat.emissiveIntensity = 0.85
    lineMat.depthWrite = false
    lineMat.depthTest = false
    lineMat.update()
    this.pathLineMaterial = lineMat

    const anchorMat = new StandardMaterial()
    anchorMat.useLighting = false
    anchorMat.emissive = new Color(0.62, 0.62, 0.66)
    anchorMat.emissiveIntensity = 1
    anchorMat.depthWrite = false
    anchorMat.depthTest = false
    anchorMat.update()
    this.pathAnchorMaterial = anchorMat

    const selectedMat = new StandardMaterial()
    selectedMat.useLighting = false
    selectedMat.emissive = new Color(0.23, 0.51, 0.96)
    selectedMat.emissiveIntensity = 1.15
    selectedMat.depthWrite = false
    selectedMat.depthTest = false
    selectedMat.update()
    this.pathAnchorSelectedMaterial = selectedMat

    const root = new Entity('path-overlay')
    this.app.root.addChild(root)
    this.pathOverlayRoot = root

    const line = new Entity('path-polyline')
    root.addChild(line)
    this.pathLineEntity = line

    const anchors = new Entity('path-anchors')
    root.addChild(anchors)
    this.pathAnchorsRoot = anchors

    this.syncPathOverlay()
  }

  private pathOverlayVisible(): boolean {
    // Orbit-only so Camera scrub / Export frames stay free of editor chrome
    return this.viewMode === 'orbit' && this.exportPixelSize === null
  }

  private applyPathOverlayVisibility() {
    if (this.pathOverlayRoot) {
      this.pathOverlayRoot.enabled = this.pathOverlayVisible()
    }
  }

  /**
   * Rebuild polyline mesh + anchor markers from the active cinema path.
   * Call after setPath / selection changes.
   */
  private syncPathOverlay() {
    if (!this.pathOverlayRoot || !this.pathLineEntity || !this.pathAnchorsRoot) return
    if (!this.pathLineMaterial || !this.pathAnchorMaterial || !this.pathAnchorSelectedMaterial) {
      return
    }

    this.applyPathOverlayVisibility()

    const polyline = samplePathPolyline(this.pathInput)
    if (polyline.length >= 2 && this.pathLineMaterial) {
      const positions = new Float32Array(polyline.length * 3)
      for (let i = 0; i < polyline.length; i++) {
        const p = polyline[i]!
        positions[i * 3] = p[0]
        positions[i * 3 + 1] = p[1]
        positions[i * 3 + 2] = p[2]
      }

      if (!this.pathLineMesh) {
        this.pathLineMesh = new Mesh(this.device)
      }
      this.pathLineMesh.clear()
      this.pathLineMesh.setPositions(positions)
      this.pathLineMesh.update(PRIMITIVE_LINESTRIP)

      const mi = new MeshInstance(this.pathLineMesh, this.pathLineMaterial)
      if (this.pathLineEntity.render) {
        this.pathLineEntity.render.meshInstances = [mi]
      } else {
        this.pathLineEntity.addComponent('render', {
          meshInstances: [mi],
          castShadows: false,
        })
      }
      this.pathLineEntity.enabled = true
    } else {
      this.pathLineEntity.enabled = false
    }

    // Recreate anchor markers (count changes often while penning)
    const stale = [...this.pathAnchorsRoot.children]
    for (const child of stale) {
      child.destroy()
    }

    const selectedId = this.draggingAnchorId ?? this.selectedAnchorId
    for (const anchor of this.pathInput.anchors) {
      const marker = new Entity(`path-anchor-${anchor.id}`)
      const material =
        anchor.id === selectedId ? this.pathAnchorSelectedMaterial : this.pathAnchorMaterial
      marker.addComponent('render', {
        type: 'box',
        material,
        castShadows: false,
      })
      const [x, y, z] = anchor.position
      marker.setPosition(x, y, z)
      // Compact world-space cubes — readable in orbit without occluding the splat
      marker.setLocalScale(0.22, 0.22, 0.22)
      this.pathAnchorsRoot.addChild(marker)
    }
  }

  private bindOrbitInput() {
    const onPointerDown = (e: PointerEvent) => {
      if (this.viewMode !== 'orbit') return
      if (e.button !== 0) return

      if (this.editTool === 'pen') {
        this.placePenAnchor({ clientX: e.clientX, clientY: e.clientY })
        return
      }

      const nearAnchor = this.pickNearestAnchor({ clientX: e.clientX, clientY: e.clientY })
      if (nearAnchor) {
        this.selectedAnchorId = nearAnchor
        this.draggingAnchorId = nearAnchor
        this.dragging = false
        this.syncPathOverlay()
        this.canvas.setPointerCapture(e.pointerId)
        return
      }

      this.dragging = true
      this.draggingAnchorId = null
      this.selectedAnchorId = null
      this.syncPathOverlay()
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.canvas.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (this.viewMode !== 'orbit') return

      if (this.draggingAnchorId) {
        const planeHit = this.hitDrawingPlane({ clientX: e.clientX, clientY: e.clientY })
        if (planeHit) this.movePathAnchor(this.draggingAnchorId, planeHit.point)
        return
      }

      if (!this.dragging) return
      const dx = e.clientX - this.lastX
      const dy = e.clientY - this.lastY
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.orbitYaw -= dx * 0.005
      this.orbitPitch = Math.min(1.4, Math.max(-0.1, this.orbitPitch + dy * 0.005))
      this.applyOrbitCamera()
    }
    const onPointerUp = (e: PointerEvent) => {
      this.dragging = false
      this.draggingAnchorId = null
      try {
        this.canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (this.viewMode !== 'orbit') return
      e.preventDefault()
      this.orbitDistance = Math.min(80, Math.max(2, this.orbitDistance * (e.deltaY > 0 ? 1.08 : 0.92)))
      this.applyOrbitCamera()
    }

    this.canvas.addEventListener('pointerdown', onPointerDown)
    this.canvas.addEventListener('pointermove', onPointerMove)
    this.canvas.addEventListener('pointerup', onPointerUp)
    this.canvas.addEventListener('wheel', onWheel, { passive: false })

    this.app.on('destroy', () => {
      this.canvas.removeEventListener('pointerdown', onPointerDown)
      this.canvas.removeEventListener('pointermove', onPointerMove)
      this.canvas.removeEventListener('pointerup', onPointerUp)
      this.canvas.removeEventListener('wheel', onWheel)
    })
  }

  private applyOrbitCamera() {
    if (this.viewMode !== 'orbit') return
    const cp = Math.cos(this.orbitPitch)
    const sp = Math.sin(this.orbitPitch)
    const cy = Math.cos(this.orbitYaw)
    const sy = Math.sin(this.orbitYaw)
    const x = this.focus.x + this.orbitDistance * cp * sy
    const y = this.focus.y + this.orbitDistance * sp
    const z = this.focus.z + this.orbitDistance * cp * cy
    this.cameraEntity.setPosition(x, y, z)
    this.cameraEntity.lookAt(this.focus)
  }

  private applyCinemaCamera() {
    this.cameraEntity.setPosition(this.cinemaPosition)
    this.cameraEntity.setRotation(this.cinemaRotation)
    const cam = this.cameraEntity.camera
    if (cam) cam.fov = this.cinemaFov
  }

  private async loadDemoLocation() {
    const asset = new Asset('demo-location', 'gsplat', { url: DEMO_LOCATION.url })
    this.app.assets.add(asset)
    await new Promise<void>((resolve, reject) => {
      asset.on('load', () => resolve())
      asset.on('error', (err: string | Error) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      })
      this.app.assets.load(asset)
    })

    const entity = new Entity(DEMO_LOCATION.name)
    entity.addComponent('gsplat', { asset })
    // Placement comes from the sidecar, not from a per-dataset magic number: the
    // Z-up capture is corrected here exactly as an ingested Location will be.
    const placement = locationTransform(DEMO_LOCATION.sidecar)
    const [px, py, pz] = placement.position
    entity.setLocalPosition(px, py, pz)
    const [ex, ey, ez] = placement.eulerDegrees
    entity.setLocalEulerAngles(ex, ey, ez)
    entity.setLocalScale(placement.scale, placement.scale, placement.scale)
    this.app.root.addChild(entity)
    this.spaceEntity = entity

    const [fx, fy, fz] = DEMO_LOCATION.focusPoint
    this.focus.set(fx, fy, fz)
    // Mathematical draw plane under the focus (no visible board over the SOG).
    this.drawingPlaneY = fy - 0.8
    const [cx, cy, cz] = DEMO_LOCATION.cameraPosition
    this.orbitDistance = 16
    // Synthesize a quarter-orbit path so scrub/warmPath use Bézier + channels + orientationTo.
    this.installSynthesizedPath([cx, cy, cz], [fx, fy, fz])
    // Space entity exists now — re-apply LOD pin / preview ranges.
    if (this.qualityManifest) this.applyLockedGsplatParams(this.qualityManifest)
    else this.applyPreviewGsplatParams()

    if (import.meta.env.DEV) {
      // dev-only handle: lets a browser check assert the placement the sidecar
      // produced, rather than judging orientation from a screenshot
      const angles = entity.getLocalEulerAngles()
      ;(window as unknown as Record<string, unknown>).__stage = {
        locationEuler: [angles.x, angles.y, angles.z],
        locationScale: entity.getLocalScale().x,
        sidecarRevision: DEMO_LOCATION.sidecar.revision,
      }
    }
  }

  private addDrawingPlane(planeY = 0, visible = true) {
    this.drawingPlaneY = planeY

    if (!visible) {
      this.drawingPlaneEntity = null
      return
    }

    const material = new StandardMaterial()
    material.diffuse = new Color(0.55, 0.55, 0.58)
    material.metalness = 0
    material.gloss = 0.08
    material.update()

    const plane = new Entity('drawing-plane')
    plane.addComponent('render', {
      type: 'plane',
      material,
      castShadows: false,
    })
    plane.setLocalPosition(0, planeY, 0)
    plane.setLocalScale(40, 1, 40)
    this.app.root.addChild(plane)
    this.drawingPlaneEntity = plane
    this.focus.set(0, planeY + 0.5, 0)
  }

  /** Clay blocking prop — proves splat + mesh compositor in the same frame. */
  private addClayProp() {
    const material = new StandardMaterial()
    // Mid grayscale clay (product rule: differentiate by shade only)
    material.diffuse = new Color(0.55, 0.55, 0.55)
    material.metalness = 0
    material.gloss = 0.12
    material.useMetalness = true
    material.update()

    const box = new Entity('clay-prop')
    box.addComponent('render', {
      type: 'box',
      material,
      castShadows: false,
    })

    if (this.spaceEntity) {
      box.setPosition(this.focus.x + 1.2, this.focus.y + 0.4, this.focus.z)
      box.setLocalScale(0.9, 0.9, 0.9)
    } else {
      box.setPosition(0, 0.5, 0)
      box.setLocalScale(1, 1, 1)
    }

    this.app.root.addChild(box)
    this.propEntity = box
    this.applyPropVisibility()
  }

  private applyPropVisibility() {
    if (!this.propEntity) return
    const show = this.viewMode === 'orbit' || this.objectBlockingVisible
    this.propEntity.enabled = show
  }

  setViewMode(mode: StageViewMode) {
    this.viewMode = mode
    this.applyPropVisibility()
    this.applyPathOverlayVisibility()
    if (mode === 'orbit') this.applyOrbitCamera()
    else {
      this.evaluateCinemaAt(this.time)
      this.applyCinemaCamera()
    }
  }

  getViewMode(): StageViewMode {
    return this.viewMode
  }

  setEditTool(tool: StageEditTool) {
    this.editTool = tool
    this.dragging = false
    this.draggingAnchorId = null
  }

  getEditTool(): StageEditTool {
    return this.editTool
  }

  /** Notify React when path geometry mutates from pen / anchor drag inside the host. */
  setOnPathChange(handler: ((path: CinemaPathInput) => void) | null) {
    this.onPathChange = handler
  }

  getDrawingPlaneY(): number {
    return this.drawingPlaneY
  }

  setDrawingPlaneY(y: number) {
    this.drawingPlaneY = y
    if (this.drawingPlaneEntity) {
      this.drawingPlaneEntity.setLocalPosition(0, y, 0)
    }
  }

  setObjectBlockingVisible(visible: boolean) {
    this.objectBlockingVisible = visible
    this.applyPropVisibility()
  }

  getQualityMode(): QualityMode {
    return this.qualityMode
  }

  getQualityManifest(): ExportManifest | null {
    return this.qualityManifest
  }

  getTime(): number {
    return this.time
  }

  /**
   * Pick stack (ARCHITECTURE-GS §6 spike): prop AABB → drawing plane.
   * Space colliders arrive with ingest / §13.7.
   */
  getHit(screen: StageScreenPoint): StageHit | null {
    const ray = this.screenRay(screen)
    if (!ray) return null

    const candidates: StageHit[] = []

    if (this.propEntity?.enabled) {
      const propHit = this.hitPropAabb(ray)
      if (propHit) {
        candidates.push({
          kind: 'prop',
          point: propHit.point,
          distance: propHit.t,
          entityName: this.propEntity.name,
        })
      }
    }

    const planeHit = intersectRayYPlane(ray, this.drawingPlaneY)
    if (planeHit) {
      candidates.push({
        kind: 'drawing-plane',
        point: planeHit.point,
        distance: planeHit.t,
        entityName: this.drawingPlaneEntity?.name ?? 'drawing-plane',
      })
    }

    if (candidates.length === 0) return null

    // Prefer props over the plane when both hit; otherwise nearer wins.
    candidates.sort((a, b) => {
      if (a.kind !== b.kind) {
        if (a.kind === 'prop') return -1
        if (b.kind === 'prop') return 1
      }
      return a.distance - b.distance
    })
    return candidates[0] ?? null
  }

  /**
   * Replace the cinema path geometry. Call with ≥2 anchors for real evaluation;
   * fewer anchors clears to "no path" (setTime then no-ops the cinema pose).
   */
  setPath(path: CinemaPathInput) {
    this.pathInput = {
      anchors: path.anchors,
      closed: path.closed ?? false,
      rounding: path.rounding ?? 0.8,
    }
    if (
      this.selectedAnchorId &&
      !this.pathInput.anchors.some((a) => a.id === this.selectedAnchorId)
    ) {
      this.selectedAnchorId = null
    }
    this.evaluateCinemaAt(this.time)
    if (this.viewMode === 'camera') this.applyCinemaCamera()
    this.syncPathOverlay()
    this.onPathChange?.(this.pathInput)
  }

  /** Append a corner anchor (pen-lite). Returns the new anchor id. */
  appendPathAnchor(position: RigVec3): string {
    const anchor = makeAnchor(position)
    this.selectedAnchorId = anchor.id
    this.setPath({
      ...this.pathInput,
      anchors: [...this.pathInput.anchors, anchor],
    })
    return anchor.id
  }

  /** Move an existing anchor by id; no-op if missing. */
  movePathAnchor(id: string, position: RigVec3) {
    let found = false
    const anchors = this.pathInput.anchors.map((a) => {
      if (a.id !== id) return a
      found = true
      return { ...a, position }
    })
    if (!found) return
    this.setPath({ ...this.pathInput, anchors })
  }

  /** Drop all anchors so the next pen stroke authors a fresh path. */
  clearPathAnchors() {
    this.selectedAnchorId = null
    this.draggingAnchorId = null
    this.setPath({
      anchors: [],
      closed: false,
      rounding: this.pathInput.rounding ?? 0.8,
    })
  }

  getAnchorCount(): number {
    return this.pathInput.anchors.length
  }

  /** Patch lens / framing channels (progress, FOV, roll, look-at). */
  setChannels(partial: Partial<CinemaChannels>) {
    this.channels = { ...this.channels, ...partial }
    this.evaluateCinemaAt(this.time)
    if (this.viewMode === 'camera') this.applyCinemaCamera()
  }

  getPath(): CinemaPathInput {
    return this.pathInput
  }

  getChannels(): CinemaChannels {
    return this.channels
  }

  /**
   * Freeze Gaussian budget / LOD for scrub or export (ARCHITECTURE-GS §4.1 / §5).
   * Pass null to restore Preview quality.
   */
  setQualityPin(manifest: ExportManifest | null) {
    this.qualityManifest = manifest
    this.qualityMode = manifest ? 'locked' : 'preview'
    if (manifest) this.applyLockedGsplatParams(manifest)
    else this.applyPreviewGsplatParams()
  }

  /**
   * Drive cinema camera (and later time-based props) from pure evaluators of t ∈ [0, 1].
   * Uses path + channels + cameraOrientation (same composition as the R3F CinemaCamera).
   */
  setTime(t: number) {
    this.time = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
    this.evaluateCinemaAt(this.time)
    if (this.viewMode === 'camera') this.applyCinemaCamera()
  }

  /**
   * Ensure Streamed SOG chunks for path samples are resident (or fail on timeout).
   * Uses PlayCanvas `gsplat` `frame:ready` (ready && loadingCount === 0).
   */
  async warmPath(
    samples: number[],
    timeoutMs?: number,
  ): Promise<void> {
    if (this.disposed) throw new Error('StageHost is disposed')
    const timeout =
      timeoutMs ??
      this.qualityManifest?.warmTimeoutMs ??
      20_000
    const previousView = this.viewMode
    const previousTime = this.time
    this.setViewMode('camera')

    try {
      const list = samples.length > 0 ? samples : [0, 1]
      for (const sample of list) {
        if (this.disposed) throw new Error('StageHost is disposed')
        this.setTime(sample)
        await this.waitForFrameReady(timeout)
      }
    } finally {
      this.time = previousTime
      this.evaluateCinemaAt(this.time)
      this.setViewMode(previousView)
    }
  }

  /**
   * Pin the canvas buffer to the ExportManifest output size (no devicePixelRatio).
   * Pass null to restore viewport sizing.
   */
  setExportPixelSize(size: { width: number; height: number } | null) {
    if (this.disposed) return
    if (!size) {
      this.exportPixelSize = null
      this.applyPathOverlayVisibility()
      this.resize()
      return
    }
    const width = Math.max(16, Math.floor(size.width))
    const height = Math.max(16, Math.floor(size.height))
    this.exportPixelSize = { width, height }
    this.applyPathOverlayVisibility()
    this.canvas.width = width
    this.canvas.height = height
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.app.resizeCanvas(width, height)
  }

  /**
   * Capture the currently presented frame after a render flush.
   *
   * PlayCanvas WebGPU's GraphicsDevice.readPixels is a no-op on the swapchain,
   * so we read the HTMLCanvasElement after the GPU presents (createImageBitmap,
   * with a 2D drawImage fallback). Documented in docs/STATUS.md.
   */
  async captureFrame(): Promise<ImageBitmap> {
    if (this.disposed) throw new Error('StageHost is disposed')
    await this.flushPresentedFrame()
    try {
      return await createImageBitmap(this.canvas)
    } catch {
      const copy = document.createElement('canvas')
      copy.width = this.canvas.width
      copy.height = this.canvas.height
      const ctx = copy.getContext('2d')
      if (!ctx) throw new Error('2D canvas unavailable for StageHost.captureFrame')
      ctx.drawImage(this.canvas, 0, 0)
      return createImageBitmap(copy)
    }
  }

  /** Wait until the next presented frame is available for canvas readout. */
  async flushPresentedFrame(): Promise<void> {
    if (this.disposed) throw new Error('StageHost is disposed')
    this.app.renderNextFrame = true
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve())
      })
    })
  }

  resize() {
    if (this.disposed) return
    if (this.exportPixelSize) {
      const { width, height } = this.exportPixelSize
      this.canvas.width = width
      this.canvas.height = height
      this.canvas.style.width = `${width}px`
      this.canvas.style.height = `${height}px`
      this.app.resizeCanvas(width, height)
      return
    }
    const parent = this.canvas.parentElement
    const width = parent?.clientWidth || this.canvas.clientWidth || 1
    const height = parent?.clientHeight || this.canvas.clientHeight || 1
    this.canvas.width = Math.max(1, Math.floor(width * (window.devicePixelRatio || 1)))
    this.canvas.height = Math.max(1, Math.floor(height * (window.devicePixelRatio || 1)))
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.app.resizeCanvas(width, height)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.pathOverlayRoot = null
    this.pathLineEntity = null
    this.pathAnchorsRoot = null
    this.pathLineMesh = null
    this.pathLineMaterial = null
    this.pathAnchorMaterial = null
    this.pathAnchorSelectedMaterial = null
    this.app.destroy()
  }

  private applyPreviewGsplatParams() {
    const params = this.app.scene.gsplat
    if (!params) return
    params.splatBudget = PREVIEW_SPLAT_BUDGET
    params.lodUpdateDistance = 0.5
    params.lodUpdateAngle = 90
    params.lodBehindPenalty = 3
    // Allow temporary coarser LODs while chunks arrive — fine for interactive preview.
    params.lodUnderfillLimit = 2
    this.applySpaceLodRange(0, 99)
  }

  private applyLockedGsplatParams(manifest: ExportManifest) {
    const params = this.app.scene.gsplat
    if (!params) return
    params.splatBudget = manifest.gaussianBudget
    params.lodUpdateDistance = 0.5
    params.lodUpdateAngle = 90
    params.lodBehindPenalty = 3
    // Do not underfill with coarser LOD once pinned — wait for the locked level.
    params.lodUnderfillLimit = 0
    const lod = Math.max(0, Math.floor(manifest.maxLod))
    this.applySpaceLodRange(lod, lod)
  }

  private applySpaceLodRange(min: number, max: number) {
    const gsplat = this.spaceEntity?.gsplat
    if (!gsplat) return
    gsplat.lodRangeMin = min
    gsplat.lodRangeMax = max
  }

  /** Install a synthesized quarter-orbit path (Demo / Blank without a drawn path). */
  private installSynthesizedPath(origin: RigVec3, focus: RigVec3) {
    const synthesized = synthesizeQuarterOrbitPath(origin, focus)
    this.pathInput = {
      anchors: synthesized.anchors,
      closed: synthesized.closed,
      rounding: synthesized.rounding,
    }
    this.channels = {
      ...this.channels,
      target: synthesized.target,
      lookAtMode: 'target',
      fov: this.cameraEntity.camera?.fov ?? 50,
    }
    this.selectedAnchorId = null
    this.evaluateCinemaAt(this.time)
    this.syncPathOverlay()
  }

  /**
   * Pure cinema evaluator f(t) via shared libs (curve + keyframes + orientationTo).
   */
  private evaluateCinemaAt(t: number) {
    const pose = evaluateCinemaPose(t, this.pathInput, this.channels)
    if (!pose) return
    this.cinemaPosition.set(pose.position[0], pose.position[1], pose.position[2])
    this.cinemaRotation.set(
      pose.quaternion[0],
      pose.quaternion[1],
      pose.quaternion[2],
      pose.quaternion[3],
    )
    this.cinemaFov = pose.fov
  }

  private screenRay(screen: StageScreenPoint): Ray3 | null {
    const cam = this.cameraEntity.camera
    if (!cam) return null
    const rect = this.canvas.getBoundingClientRect()
    const { x, y } = clientToCanvasPixels(screen.clientX, screen.clientY, rect)
    const near = new Vec3()
    const far = new Vec3()
    cam.screenToWorld(x, y, cam.nearClip, near)
    cam.screenToWorld(x, y, cam.farClip, far)
    const direction = new Vec3().sub2(far, near)
    if (direction.lengthSq() < 1e-12) return null
    direction.normalize()
    return {
      origin: [near.x, near.y, near.z],
      direction: [direction.x, direction.y, direction.z],
    }
  }

  private hitPropAabb(ray: Ray3): RayHit | null {
    if (!this.propEntity) return null
    const pos = this.propEntity.getPosition()
    const scale = this.propEntity.getLocalScale()
    const aabb = aabbFromCenterSize(
      [pos.x, pos.y, pos.z],
      [scale.x, scale.y, scale.z],
    )
    return intersectRayAabb(ray, aabb)
  }

  private hitDrawingPlane(screen: StageScreenPoint): StageHit | null {
    const ray = this.screenRay(screen)
    if (!ray) return null
    const hit = intersectRayYPlane(ray, this.drawingPlaneY)
    if (!hit) return null
    return {
      kind: 'drawing-plane',
      point: hit.point,
      distance: hit.t,
      entityName: this.drawingPlaneEntity?.name ?? 'drawing-plane',
    }
  }

  private placePenAnchor(screen: StageScreenPoint) {
    // Pen authors on the drawing plane (same as R3F PenTool), even if a prop is closer.
    const plane = this.hitDrawingPlane(screen)
    if (!plane) return
    this.appendPathAnchor(plane.point)
  }

  private pickNearestAnchor(screen: StageScreenPoint): string | null {
    const plane = this.hitDrawingPlane(screen)
    if (!plane || this.pathInput.anchors.length === 0) return null
    const radiusSq = this.anchorPickRadius * this.anchorPickRadius
    let best: PathAnchor | null = null
    let bestDist = radiusSq
    for (const anchor of this.pathInput.anchors) {
      const d = horizontalDistanceSq(anchor.position, plane.point)
      if (d <= bestDist) {
        bestDist = d
        best = anchor
      }
    }
    return best?.id ?? null
  }

  private waitForFrameReady(timeoutMs: number): Promise<void> {
    const system = this.app.systems.gsplat
    // Blank stage / no splat system — nothing to stream.
    if (!system || !this.spaceEntity) {
      return new Promise((resolve) => {
        requestAnimationFrame(() => resolve())
      })
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const started = performance.now()

      const cleanup = () => {
        system.off('frame:ready', onFrameReady)
        window.clearTimeout(timer)
      }

      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }

      const onFrameReady = (
        _camera: unknown,
        _layer: unknown,
        ready: boolean,
        loadingCount: number,
      ) => {
        if (ready && loadingCount === 0) {
          finish()
          return
        }
        if (performance.now() - started > timeoutMs) {
          finish(new WarmPathTimeoutError(timeoutMs))
        }
      }

      const timer = window.setTimeout(() => {
        finish(new WarmPathTimeoutError(timeoutMs))
      }, timeoutMs)

      system.on('frame:ready', onFrameReady)
    })
  }
}
