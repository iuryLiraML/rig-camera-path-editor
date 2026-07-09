import { useEffect, useState, type DragEvent } from 'react'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { useRigStore } from '../state/useRigStore'
import { usePathStore, selectCameraAnchorCount } from '../state/usePathStore'
import { Viewport } from '../viewport/Viewport'
import { Toolbar } from '../ui/Toolbar'
import { LeftPanel } from '../ui/LeftPanel'
import { RightPanel } from '../ui/RightPanel'
import { ViewportFooter } from '../ui/ViewportFooter'
import { Timeline } from '../ui/Timeline'
import { OnboardingCard } from '../ui/OnboardingCard'
import { CameraPreviewFrame } from '../ui/CameraPreviewFrame'
import { AreaLayer } from '../ui/AreaLayer'
import { SettingsDialog } from '../ui/SettingsDialog'
import { BoardView } from '../ui/BoardView'
import { cancelRecording, isRecording } from '../lib/recorder'
import { redo, undo } from '../lib/history'
import { importModelFile } from '../lib/sceneIO'

function ViewSwitcher() {
  const appView = useEditorStore((s) => s.appView)
  const setAppView = useEditorStore((s) => s.setAppView)
  return (
    <div className="panel absolute left-[244px] top-3 z-40 flex items-center gap-0.5 px-1 py-1">
      {(
        [
          { value: 'editor', label: 'Editor' },
          { value: 'board', label: 'Board' },
        ] as const
      ).map((option) => (
        <button
          key={option.value}
          onClick={() => setAppView(option.value)}
          className={`rounded-md px-2.5 py-1 text-[11px] ${
            appView === option.value ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function isTyping() {
  const el = document.activeElement
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
}

function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping()) return
      const editor = useEditorStore.getState()
      const rig = useRigStore.getState()
      const path = usePathStore.getState()

      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        redo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        if (editor.selection?.startsWith('obj:')) {
          e.preventDefault()
          useSceneStore.getState().duplicateObject(editor.selection.slice(4))
        }
        return
      }

      switch (e.key) {
        case 'v':
        case 'V':
          editor.setTool('select')
          break
        case 'p':
        case 'P':
          if (!editor.playMode) editor.setTool('pen')
          break
        case 'w':
        case 'W':
          editor.setGizmoMode('translate')
          break
        case 'e':
        case 'E':
          editor.setGizmoMode('rotate')
          break
        case 'r':
        case 'R':
          editor.setGizmoMode('scale')
          break
        case 'f':
        case 'F':
          editor.requestFrame()
          break
        case ' ':
          e.preventDefault()
          if (selectCameraAnchorCount(path) >= 2) rig.setPlaying(!rig.playing)
          break
        case 'Enter':
          if (editor.tool === 'pen') {
            editor.setTool('select')
            editor.select('camera-path')
          }
          break
        case 'Escape':
          if (isRecording()) {
            cancelRecording()
          } else if (editor.playMode) {
            editor.setPlayMode(false)
            rig.setPlaying(false)
          } else if (editor.cameraView) {
            editor.setCameraView(false)
          } else if (editor.tool === 'pen') {
            editor.setTool('select')
          } else if (path.selectedHandle !== 'none') {
            path.selectHandle('none')
          } else if (path.selectedAnchorId) {
            path.selectAnchor(null)
          } else {
            editor.select(null)
          }
          break
        case 'Delete':
        case 'Backspace':
          if (path.selectedAnchorId) {
            path.removeAnchor(path.selectedAnchorId)
          } else if (editor.selection?.startsWith('obj:') && !editor.playMode) {
            useSceneStore.getState().removeObject(editor.selection.slice(4))
            editor.select(null)
          }
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

export function App() {
  const notice = useSceneStore((s) => s.notice)
  const importing = useSceneStore((s) => s.importing)
  const showNotice = useSceneStore((s) => s.showNotice)
  const playMode = useEditorStore((s) => s.playMode)
  const recording = useEditorStore((s) => s.recording)
  const recordProgress = useEditorStore((s) => s.recordProgress)
  const appView = useEditorStore((s) => s.appView)
  const [dragging, setDragging] = useState(false)

  useShortcuts()

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      setDragging(true)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (files.length === 0) return
    const models = files.filter((f) => /\.(glb|gltf)$/i.test(f.name))
    if (models.length === 0) {
      showNotice('Unsupported file — drop a .glb or .gltf')
      return
    }
    models.forEach((f) => void importModelFile(f))
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <Viewport />

      {appView === 'editor' && <AreaLayer />}

      {!playMode && (
        <>
          <Toolbar />
          <LeftPanel />
          <RightPanel />
          <Timeline />
          <ViewportFooter />
          <OnboardingCard />
          <CameraPreviewFrame />
          <ViewSwitcher />
        </>
      )}

      {appView === 'board' && !playMode && <BoardView />}

      <SettingsDialog />

      {playMode && !recording && (
        <button
          onClick={() => {
            useEditorStore.getState().setPlayMode(false)
            useRigStore.getState().setPlaying(false)
          }}
          className="panel absolute right-4 top-4 z-30 px-3 py-1.5 text-[11px] text-ink-dim hover:text-ink"
        >
          Esc to exit
        </button>
      )}

      {recording && (
        <div className="panel absolute right-4 top-4 z-30 flex items-center gap-2 px-3 py-1.5 text-[11px] text-ink">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          {Number.isNaN(recordProgress) ? (
            <>Recording…</>
          ) : (
            <>Rendering MP4 · {Math.round(recordProgress * 100)}%</>
          )}
          <span className="text-ink-dim">Esc to cancel</span>
        </div>
      )}

      {notice && (
        <div className="panel absolute left-1/2 top-16 z-30 -translate-x-1/2 px-4 py-2 text-xs text-ink">
          {notice}
        </div>
      )}

      {importing > 0 && (
        <div className="panel absolute left-1/2 top-28 z-30 flex -translate-x-1/2 items-center gap-2 px-4 py-2 text-xs text-ink">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Importing model…
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="panel border-2 border-dashed border-accent px-10 py-8 text-sm text-ink">
            Drop your <span className="font-semibold text-accent">.glb</span> to import
          </div>
        </div>
      )}
    </div>
  )
}
