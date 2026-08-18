import { create } from 'zustand'
import type { KeyableFocus } from '../lib/keyAtPlayhead'
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
  /** a video export is currently being recorded */
  recording: boolean
  /** 0..1 progress of the offline MP4 render (NaN for realtime capture) */
  recordProgress: number
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
  /** Design field that should receive I, or null to use the selection rule */
  keyableFocus: KeyableFocus | null
  /** settings dialog (API keys, model, guidelines) */
  showSettings: boolean
  /** incremented to ask the editor camera to frame the model (F) */
  frameRequest: number
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
  setTool: (tool: Tool) => void
  setProjection: (projection: Projection) => void
  select: (id: SelectableId | null) => void
  selectKeyframe: (key: SelectedTimelineKey | null) => void
  selectTimelineKey: (key: SelectedTimelineKey, id: SelectableId) => void
  setGizmoMode: (mode: GizmoMode) => void
  setPlayMode: (on: boolean) => void
  setCameraView: (on: boolean) => void
  setRecording: (on: boolean) => void
  setRecordProgress: (progress: number) => void
  setExportAspect: (aspect: ExportAspect) => void
  setExportRes: (res: ExportRes) => void
  setCustomSize: (size: [number, number]) => void
  setViewMode: (mode: ViewMode) => void
  setAppView: (view: AppView) => void
  toggleExportPass: (pass: ViewMode) => void
  setExportSize: (size: [number, number] | null) => void
  setShowPreview: (on: boolean) => void
  setPanelTab: (tab: PanelTab) => void
  setKeyableFocus: (focus: KeyableFocus | null) => void
  setPipRect: (rect: { right: number; bottom: number; fraction: number }) => void
  setShowSettings: (on: boolean) => void
  requestFrame: () => void
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
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'select',
  projection: 'perspective',
  selection: null,
  gizmoMode: 'translate',
  playMode: false,
  cameraView: false,
  recording: false,
  recordProgress: NaN,
  exportAspect: '16:9',
  exportRes: 1080,
  customSize: [1920, 1080],
  appView: 'editor',
  viewMode: 'clay',
  exportPasses: ['clay'],
  exportSize: null,
  showPreview: true,
  pipRect: { right: 344, bottom: 192, fraction: 0.22 },
  panelTab: 'design',
  keyableFocus: null,
  showSettings: false,
  frameRequest: 0,
  viewRequest: null,
  zoomPct: 100,
  snapEnabled: false,
  gridSize: 0.5,
  timelineEasing: false,
  easingLinked: true,
  timelineHeight: 240,
  timelineView: FULL_TIME_VIEW,
  selectedKeyframe: null,
  timelineGraph: false,
  graphChannel: 'progress',
  setTool: (tool) => set({ tool }),
  setProjection: (projection) => set({ projection }),
  select: (selection) => {
    set({ selection, selectedKeyframe: null })
    // Empty viewport click and picking anything but the path must drop the
    // spline-point set, otherwise W/E/R stays glued to the last anchors.
    if (selection !== 'camera-path') usePathStore.getState().selectAnchor(null)
  },
  selectKeyframe: (selectedKeyframe) => set({ selectedKeyframe }),
  selectTimelineKey: (selectedKeyframe, selection) => set({ selectedKeyframe, selection }),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  setPlayMode: (playMode) => set({ playMode }),
  setCameraView: (cameraView) => set({ cameraView }),
  setRecording: (recording) => set({ recording }),
  setRecordProgress: (recordProgress) => set({ recordProgress }),
  setExportAspect: (exportAspect) => set({ exportAspect }),
  setExportRes: (exportRes) => set({ exportRes }),
  setCustomSize: (customSize) => set({ customSize }),
  setViewMode: (viewMode) => set({ viewMode }),
  setAppView: (appView) => set({ appView }),
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
}))
