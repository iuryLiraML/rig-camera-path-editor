import { create } from 'zustand'
import type { KeyableFocus } from '../lib/keyAtPlayhead'
import {
  DEFAULT_COMPOSITION_GUIDES,
  toggleCompositionGuide,
  type CompositionGuideId,
  type CompositionGuides,
} from '../lib/compositionGuides'
import { clampTimeView, FULL_TIME_VIEW, type TimeView } from '../lib/timeView'
import { usePathStore } from './usePathStore'
import type { RigChannel } from './useRigStore'

export type SelectedTimelineKey =
  | { kind: 'rig'; channel: RigChannel; id: string }
  | { kind: 'object'; objectId: string; id: string }

export type Tool = 'select' | 'pen'
export type Projection = 'perspective' | 'orthographic'
export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type ExportAspect = '16:9' | '1:1' | '9:16'
export type ExportRes = 720 | 1080 | 'custom'
export type QuickView = 'front' | 'top' | 'right'
export type ViewMode = 'clay' | 'depth' | 'outline' | 'normals'
export type AppView = 'projects' | 'editor' | 'board' | 'intake'
export type PanelTab = 'design' | 'assistant'
/** Job the editor chrome is serving. Same 3D scene; different overlays. */
export type WorkspaceMode = 'build' | 'compose' | 'visualize'
export type ComposeDock = 'sequence' | 'timeline'
export type ObjectBarPanel = 'none' | 'transform' | 'name' | 'properties' | 'more'
/** Floating camera inspector in Compose — not inside the outliner tree. */
export type CameraPanel = 'closed' | 'adjust' | 'fx'
export type VisualizeMedia = 'still' | 'motion'
export type RecordingKind = 'video' | 'still'

export type SelectableId =
  | 'light'
  | 'camera-path'
  | 'cinema-camera'
  | 'target'
  | `obj:${string}`

interface EditorState {
  tool: Tool
  projection: Projection
  selection: SelectableId | null
  gizmoMode: GizmoMode
  playMode: boolean
  /** main viewport looks through the cinema camera (editing UI stays visible) */
  cameraView: boolean
  /** a video export or still capture is currently being recorded */
  recording: boolean
  /** still capture must not look like an MP4 export */
  recordingKind: RecordingKind | null
  /** 0..1 progress of the offline MP4 render (NaN for realtime capture) */
  recordProgress: number
  /** Depth-pass near plane when `depthRangeAuto` is off */
  depthNear: number
  /** Depth-pass far plane when `depthRangeAuto` is off */
  depthFar: number
  /** When true, depth near/far follow scene bounds every frame */
  depthRangeAuto: boolean
  /** shot currently framed in Compose (HUD / Sequence highlight) */
  activeShotId: string | null
  exportAspect: ExportAspect
  exportRes: ExportRes
  /** manual output size, used when exportRes === 'custom' */
  customSize: [number, number]
  /** editor canvas vs shots board (storyboard) */
  appView: AppView
  /** global render mode of the viewport, PiP and exports */
  viewMode: ViewMode
  /** passes selected for video/frame export */
  exportPasses: ViewMode[]
  /** when set, the canvas container is forced to this pixel size (offline render) */
  exportSize: [number, number] | null
  /** picture-in-picture preview of the cinema camera */
  showPreview: boolean
  /** PiP position/size — right/bottom in CSS px from those edges, fraction of viewport */
  pipRect: { right: number; bottom: number; fraction: number }
  /** leftover tab key — side columns no longer tab between Design/Director.
   *  Kept so persisted editor state and viewportInsets() callers stay typed. */
  panelTab: PanelTab
  /** Build = place, Compose = frame, Visualize = generate. */
  workspaceMode: WorkspaceMode
  /** Sequence strip vs AE timeline, only while Compose is active. */
  composeDock: ComposeDock
  /** Outliner overlay (Build/Compose). Not a permanent column. */
  showOutliner: boolean
  /** Add-an-object drawer (Build). */
  showAddDrawer: boolean
  /** Which object-bar popover is open. */
  objectBarPanel: ObjectBarPanel
  /** Compose camera inspector (Adjust / FX). Independent of the outliner. */
  cameraPanel: CameraPanel
  /** Import Assets modal. */
  showImportModal: boolean
  /** Object ids that refuse transform (Lock on the object bar). */
  lockedIds: string[]
  /** Visualize Generate media toggle — still vs motion reference. */
  visualizeMedia: VisualizeMedia
  /** Director composer transcript is open above the floating bar. */
  directorExpanded: boolean
  /** Design field that should receive I, or null to use the selection rule */
  keyableFocus: KeyableFocus | null
  /** settings dialog (API keys, model, guidelines) */
  showSettings: boolean
  /** incremented to ask the editor camera to frame the model (F) */
  frameRequest: number
  /** incremented to aim the editor camera at the world origin (H) */
  homeRequest: number
  /** quick view snap request for the editor camera */
  viewRequest: { view: QuickView; n: number } | null
  /** live editor zoom readout (100% = default framing) */
  zoomPct: number
  /** pen tool: snap new/edited points to the XZ grid */
  snapEnabled: boolean
  /** grid cell used by snapping, in world units */
  gridSize: number
  /** show Cascadeur-style interval spacing handles on the timeline */
  timelineEasing: boolean
  /** when true, a key's easeIn and easeOut stay equal (one weight) */
  easingLinked: boolean
  /** requested timeline dock height in px (chromeSizes may shrink it) */
  timelineHeight: number
  /** visible 0..1 window of the shot on the ruler */
  timelineView: TimeView
  /** diamond selected on a timeline track (Delete removes it) */
  selectedKeyframe: SelectedTimelineKey | null
  /** After Effects Graph Editor — value graph instead of stacked tracks */
  timelineGraph: boolean
  /** which camera channel the graph is focused on */
  graphChannel: RigChannel
  /** keyboard cheat-sheet overlay */
  showShortcuts: boolean
  /** Look-through fly is previewing rest pose until Add pose / Record / scrub. */
  lookThroughLivePose: boolean
  /** Drone take: time advances and fly writes pose keys. */
  flyRecording: boolean
  /** On-lens composition guides while looking through. */
  compositionGuides: CompositionGuides
  setTool: (tool: Tool) => void
  setProjection: (projection: Projection) => void
  select: (id: SelectableId | null) => void
  selectKeyframe: (key: SelectedTimelineKey | null) => void
  selectTimelineKey: (key: SelectedTimelineKey, id: SelectableId) => void
  setGizmoMode: (mode: GizmoMode) => void
  setPlayMode: (on: boolean) => void
  setCameraView: (on: boolean) => void
  setRecording: (on: boolean, kind?: RecordingKind) => void
  setRecordProgress: (progress: number) => void
  setActiveShotId: (id: string | null) => void
  setExportAspect: (aspect: ExportAspect) => void
  setExportRes: (res: ExportRes) => void
  setCustomSize: (size: [number, number]) => void
  setViewMode: (mode: ViewMode) => void
  setDepthNear: (near: number) => void
  setDepthFar: (far: number) => void
  setDepthRangeAuto: (on: boolean) => void
  setAppView: (view: AppView) => void
  setWorkspaceMode: (mode: WorkspaceMode) => void
  setComposeDock: (dock: ComposeDock) => void
  setShowOutliner: (on: boolean) => void
  toggleOutliner: () => void
  setShowAddDrawer: (on: boolean) => void
  toggleAddDrawer: () => void
  setObjectBarPanel: (panel: ObjectBarPanel) => void
  setCameraPanel: (panel: CameraPanel) => void
  setShowImportModal: (on: boolean) => void
  toggleLock: (id: string) => void
  setVisualizeMedia: (media: VisualizeMedia) => void
  setDirectorExpanded: (on: boolean) => void
  toggleExportPass: (pass: ViewMode) => void
  setExportSize: (size: [number, number] | null) => void
  setShowPreview: (on: boolean) => void
  setPanelTab: (tab: PanelTab) => void
  setKeyableFocus: (focus: KeyableFocus | null) => void
  setPipRect: (rect: { right: number; bottom: number; fraction: number }) => void
  setShowSettings: (on: boolean) => void
  requestFrame: () => void
  requestHome: () => void
  requestView: (view: QuickView) => void
  setZoomPct: (pct: number) => void
  setSnapEnabled: (on: boolean) => void
  toggleSnap: () => void
  setGridSize: (size: number) => void
  setTimelineEasing: (on: boolean) => void
  toggleTimelineEasing: () => void
  setEasingLinked: (on: boolean) => void
  setTimelineHeight: (height: number) => void
  setTimelineView: (view: TimeView) => void
  setTimelineGraph: (on: boolean) => void
  toggleTimelineGraph: () => void
  setGraphChannel: (channel: RigChannel) => void
  setShowShortcuts: (on: boolean) => void
  toggleShortcuts: () => void
  setLookThroughLivePose: (on: boolean) => void
  setFlyRecording: (on: boolean) => void
  toggleCompositionGuide: (id: CompositionGuideId) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'select',
  projection: 'perspective',
  selection: null,
  gizmoMode: 'translate',
  playMode: false,
  cameraView: false,
  recording: false,
  recordingKind: null,
  recordProgress: NaN,
  activeShotId: null,
  exportAspect: '16:9',
  exportRes: 1080,
  customSize: [1920, 1080],
  appView: 'editor',
  workspaceMode: 'build',
  composeDock: 'sequence',
  showOutliner: false,
  showAddDrawer: false,
  objectBarPanel: 'none',
  cameraPanel: 'closed',
  showImportModal: false,
  lockedIds: [],
  visualizeMedia: 'still',
  directorExpanded: false,
  viewMode: 'clay',
  depthNear: 0.1,
  depthFar: 20,
  depthRangeAuto: true,
  exportPasses: ['clay'],
  exportSize: null,
  showPreview: true,
  pipRect: { right: 16, bottom: 192, fraction: 0.22 },
  panelTab: 'design',
  keyableFocus: null,
  showSettings: false,
  frameRequest: 0,
  homeRequest: 0,
  viewRequest: null,
  zoomPct: 100,
  snapEnabled: false,
  gridSize: 0.5,
  timelineEasing: false,
  easingLinked: true,
  timelineHeight: 312,
  timelineView: FULL_TIME_VIEW,
  selectedKeyframe: null,
  timelineGraph: false,
  graphChannel: 'progress',
  showShortcuts: false,
  lookThroughLivePose: false,
  flyRecording: false,
  compositionGuides: { ...DEFAULT_COMPOSITION_GUIDES },
  setTool: (tool) => set({ tool }),
  setProjection: (projection) => set({ projection }),
  select: (selection) => {
    set((s) => ({
      selection,
      selectedKeyframe: null,
      cameraPanel:
        selection === 'cinema-camera' && s.workspaceMode === 'compose' && s.cameraPanel === 'closed'
          ? 'adjust'
          : s.cameraPanel,
    }))
    // Empty viewport click and picking anything but the path must drop the
    // spline-point set, otherwise W/E/R stays glued to the last anchors.
    if (selection !== 'camera-path') usePathStore.getState().selectAnchor(null)
  },
  selectKeyframe: (selectedKeyframe) => set({ selectedKeyframe }),
  selectTimelineKey: (selectedKeyframe, selection) => set({ selectedKeyframe, selection }),
  setGizmoMode: (gizmoMode) =>
    set((s) => ({
      gizmoMode,
      // W / E / R is how Transform is invoked — open the numeric panel so the
      // per-parameter keyframe diamonds are on screen, not only on ObjectBar Move.
      objectBarPanel: s.selection?.startsWith('obj:') ? 'transform' : s.objectBarPanel,
    })),
  setPlayMode: (playMode) => set({ playMode }),
  setCameraView: (cameraView) =>
    set(
      cameraView
        ? { cameraView }
        : { cameraView, flyRecording: false, lookThroughLivePose: false },
    ),
  setRecording: (recording, kind = 'video') =>
    set({ recording, recordingKind: recording ? kind : null }),
  setActiveShotId: (activeShotId) => set({ activeShotId }),
  setRecordProgress: (recordProgress) => set({ recordProgress }),
  setExportAspect: (exportAspect) => set({ exportAspect }),
  setExportRes: (exportRes) => set({ exportRes }),
  setCustomSize: (customSize) => set({ customSize }),
  setViewMode: (viewMode) => set({ viewMode }),
  setDepthNear: (depthNear) => set({ depthNear: Math.max(0.05, depthNear), depthRangeAuto: false }),
  setDepthFar: (depthFar) => set({ depthFar: Math.max(0.06, depthFar), depthRangeAuto: false }),
  setDepthRangeAuto: (depthRangeAuto) => set({ depthRangeAuto }),
  setAppView: (appView) => {
    if (appView === 'board') {
      set({
        appView: 'editor',
        workspaceMode: 'compose',
        composeDock: 'sequence',
      })
      return
    }
    set({ appView })
  },
  setWorkspaceMode: (workspaceMode) =>
    set((s) => ({
      workspaceMode,
      ...(workspaceMode !== 'compose' && s.cameraView
        ? { cameraView: false, flyRecording: false, lookThroughLivePose: false }
        : {}),
      tool:
        workspaceMode === 'visualize'
          ? 'select'
          : workspaceMode !== 'compose' && s.tool === 'pen'
            ? 'select'
            : s.tool,
      showAddDrawer: workspaceMode === 'build' ? s.showAddDrawer : false,
      objectBarPanel: workspaceMode === 'visualize' ? 'none' : s.objectBarPanel,
      showOutliner: workspaceMode === 'build' ? s.showOutliner : false,
      cameraPanel: workspaceMode === 'compose' ? s.cameraPanel : 'closed',
    })),
  setComposeDock: (composeDock) => set({ composeDock }),
  setShowOutliner: (showOutliner) => set({ showOutliner }),
  toggleOutliner: () => set((s) => ({ showOutliner: !s.showOutliner })),
  setShowAddDrawer: (showAddDrawer) => set({ showAddDrawer }),
  toggleAddDrawer: () => set((s) => ({ showAddDrawer: !s.showAddDrawer })),
  setObjectBarPanel: (objectBarPanel) => set({ objectBarPanel }),
  setCameraPanel: (cameraPanel) => set({ cameraPanel }),
  setShowImportModal: (showImportModal) => set({ showImportModal }),
  toggleLock: (id) =>
    set((s) => ({
      lockedIds: s.lockedIds.includes(id)
        ? s.lockedIds.filter((locked) => locked !== id)
        : [...s.lockedIds, id],
    })),
  setVisualizeMedia: (visualizeMedia) => set({ visualizeMedia }),
  setDirectorExpanded: (directorExpanded) => set({ directorExpanded }),
  toggleExportPass: (pass) =>
    set((s) => ({
      exportPasses: s.exportPasses.includes(pass)
        ? s.exportPasses.filter((p) => p !== pass)
        : [...s.exportPasses, pass],
    })),
  setExportSize: (exportSize) => set({ exportSize }),
  setShowPreview: (showPreview) => set({ showPreview }),
  setPanelTab: (panelTab) => set({ panelTab }),
  setKeyableFocus: (keyableFocus) => set({ keyableFocus }),
  setPipRect: (pipRect) => set({ pipRect }),
  setShowSettings: (showSettings) => set({ showSettings }),
  requestFrame: () => set((s) => ({ frameRequest: s.frameRequest + 1 })),
  requestHome: () => set((s) => ({ homeRequest: s.homeRequest + 1 })),
  requestView: (view) => set((s) => ({ viewRequest: { view, n: (s.viewRequest?.n ?? 0) + 1 } })),
  setZoomPct: (zoomPct) => set({ zoomPct }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  setGridSize: (gridSize) => set({ gridSize: Math.max(0.01, gridSize) }),
  setTimelineEasing: (timelineEasing) => set({ timelineEasing }),
  toggleTimelineEasing: () => set((s) => ({ timelineEasing: !s.timelineEasing })),
  setEasingLinked: (easingLinked) => set({ easingLinked }),
  setTimelineHeight: (timelineHeight) => set({ timelineHeight }),
  setTimelineView: (view) => set({ timelineView: clampTimeView(view.start, view.span) }),
  setTimelineGraph: (timelineGraph) =>
    set((s) => ({
      timelineGraph,
      timelineHeight: timelineGraph ? Math.max(s.timelineHeight, 300) : s.timelineHeight,
    })),
  toggleTimelineGraph: () =>
    set((s) => {
      const timelineGraph = !s.timelineGraph
      return {
        timelineGraph,
        timelineHeight: timelineGraph ? Math.max(s.timelineHeight, 300) : s.timelineHeight,
      }
    }),
  setGraphChannel: (graphChannel) => set({ graphChannel }),
  setShowShortcuts: (showShortcuts) => set({ showShortcuts }),
  toggleShortcuts: () => set((s) => ({ showShortcuts: !s.showShortcuts })),
  setLookThroughLivePose: (lookThroughLivePose) => set({ lookThroughLivePose }),
  setFlyRecording: (flyRecording) => set({ flyRecording }),
  toggleCompositionGuide: (id) =>
    set((s) => ({ compositionGuides: toggleCompositionGuide(s.compositionGuides, id) })),
}))
