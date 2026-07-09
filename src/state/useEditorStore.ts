import { create } from 'zustand'

export type Tool = 'select' | 'pen'
export type Projection = 'perspective' | 'orthographic'
export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type ExportAspect = '16:9' | '1:1' | '9:16'
export type ExportRes = 720 | 1080 | 'custom'
export type QuickView = 'front' | 'top' | 'right'
export type ViewMode = 'clay' | 'depth' | 'outline' | 'normals'
export type AppView = 'editor' | 'board'

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
  /** settings dialog (API keys, model, guidelines) */
  showSettings: boolean
  /** incremented to ask the editor camera to frame the model (F) */
  frameRequest: number
  /** quick view snap request for the editor camera */
  viewRequest: { view: QuickView; n: number } | null
  /** live editor zoom readout (100% = default framing) */
  zoomPct: number
  setTool: (tool: Tool) => void
  setProjection: (projection: Projection) => void
  select: (id: SelectableId | null) => void
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
  setPipRect: (rect: { right: number; bottom: number; fraction: number }) => void
  setShowSettings: (on: boolean) => void
  requestFrame: () => void
  requestView: (view: QuickView) => void
  setZoomPct: (pct: number) => void
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
  pipRect: { right: 264, bottom: 192, fraction: 0.22 },
  showSettings: false,
  frameRequest: 0,
  viewRequest: null,
  zoomPct: 100,
  setTool: (tool) => set({ tool }),
  setProjection: (projection) => set({ projection }),
  select: (selection) => set({ selection }),
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
  setPipRect: (pipRect) => set({ pipRect }),
  setShowSettings: (showSettings) => set({ showSettings }),
  requestFrame: () => set((s) => ({ frameRequest: s.frameRequest + 1 })),
  requestView: (view) => set((s) => ({ viewRequest: { view, n: (s.viewRequest?.n ?? 0) + 1 } })),
  setZoomPct: (zoomPct) => set({ zoomPct }),
}))
