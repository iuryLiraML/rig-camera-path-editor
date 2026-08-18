import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { useRigStore } from '../state/useRigStore'
import { usePathStore } from '../state/usePathStore'
import { cameraReady } from '../state/cameraPathLink'
import { Viewport } from '../viewport/Viewport'
import { Toolbar } from '../ui/Toolbar'
import { LeftPanel } from '../ui/LeftPanel'
import { RightPanel } from '../ui/RightPanel'
import { ViewportFooter } from '../ui/ViewportFooter'
import { Timeline } from '../ui/Timeline'
import { OnboardingCard } from '../ui/OnboardingCard'
import { CameraPreviewFrame } from '../ui/CameraPreviewFrame'
import { CameraRigHud } from '../ui/CameraRigHud'
import { AreaLayer } from '../ui/AreaLayer'
import { useViewportInsets } from '../ui/viewportInsets'
import { SettingsDialog } from '../ui/SettingsDialog'
import { BoardView } from '../ui/BoardView'
import { ProjectsWorkspace } from '../ui/ProjectsWorkspace'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { isTeamCloudApp } from '../lib/cloud/client'
import { reloadActiveProjectFromCloud } from '../lib/projects'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import { cancelRecording, isRecording } from '../lib/recorder'
import { redo, undo } from '../lib/history'
import { insertKeyframeAtPlayhead } from '../lib/insertKeyframe'
import { deleteSelectedTimelineKey } from '../lib/timelineKey'
import { applyTogglePlayback } from '../lib/playback'
import { importModelFile } from '../lib/sceneIO'
import { useProjectStore } from '../state/useProjectStore'
import { resolveWorkspace } from './resolveWorkspace'
import { useCameraOptionsStore } from '../state/useCameraOptionsStore'

function ViewSwitcher() {
  const appView = useEditorStore((s) => s.appView)
  const setAppView = useEditorStore((s) => s.setAppView)
  const insets = useViewportInsets()
  return (
    <div
      className="panel absolute top-3 z-40 flex shrink-0 items-center gap-0.5 whitespace-nowrap px-1 py-1"
      style={{ left: insets.left }}
    >
      {(
        [
          { value: 'projects', label: 'Projects' },
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

function isKeyableField() {
  const el = document.activeElement
  return el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'range')
}

function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping() && !((e.key === 'i' || e.key === 'I') && isKeyableField())) return
      const editor = useEditorStore.getState()
      const rig = useRigStore.getState()
      const path = usePathStore.getState()

      // looking through a free camera: WASD/QE fly — don't steal them for gizmos
      if (
        editor.cameraView &&
        rig.cameraKind === 'static' &&
        !e.ctrlKey &&
        !e.metaKey &&
        ['w', 'a', 's', 'd', 'q', 'e'].includes(e.key.toLowerCase())
      ) {
        return
      }

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
        case 'i':
        case 'I':
          e.preventDefault()
          insertKeyframeAtPlayhead()
          break
        case ' ':
          e.preventDefault()
          if (cameraReady()) applyTogglePlayback()
          break
        case '1':
        case '2':
        case '3':
        case '4':
          if (path.selectedAnchorIds.length > 0) {
            const modes = ['auto', 'smooth', 'corner', 'broken'] as const
            path.setAnchorsTangent(path.selectedAnchorIds, modes[Number(e.key) - 1])
          }
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
          } else if (editor.selectedKeyframe) {
            editor.selectKeyframe(null)
          } else if (path.selectedHandle !== 'none') {
            path.selectHandle('none')
          } else if (path.selectedAnchorIds.length > 0) {
            path.selectAnchor(null)
          } else {
            editor.select(null)
          }
          break
        case 'Delete':
        case 'Backspace':
          if (deleteSelectedTimelineKey()) {
            e.preventDefault()
          } else if (path.selectedAnchorIds.length > 0) {
            path.removeAnchors(path.selectedAnchorIds)
          } else if (editor.selection === 'cinema-camera' && !editor.playMode) {
            // Delete removed objects and anchors but silently did nothing on a
            // camera, which reinforced that cameras were undeletable
            const cameras = useCameraOptionsStore.getState()
            if (cameras.options.length > 1) {
              cameras.removeOption(cameras.activeOptionId)
              useSceneStore.getState().showNotice('Camera deleted')
            } else {
              useSceneStore.getState().showNotice('The last camera cannot be deleted')
            }
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

function EditorWorkspace() {
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
          <CameraRigHud />
          <ViewSwitcher />
        </>
      )}

      {appView === 'board' && !playMode && <BoardView />}

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

function SaveConflictDialog() {
  const conflict = useCloudAuthStore((state) => state.saveConflict)
  if (!conflict) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="panel w-[min(92vw,420px)] p-5">
        <h2 className="text-sm font-semibold text-ink">This project was saved on another device</h2>
        <p className="mt-2 text-xs leading-5 text-ink-dim">
          Reload to take the cloud version, or overwrite to keep this machine’s edits.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              void reloadActiveProjectFromCloud().catch((error) => {
                console.error(error)
              })
            }}
            className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink hover:bg-panel-3"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => {
              void syncActiveProjectToCloud({ ifMatch: conflict.updatedAt }).catch((error) => {
                console.error(error)
              })
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            Overwrite
          </button>
        </div>
      </div>
    </div>
  )
}

export function App() {
  const booted = useProjectStore((state) => state.booted)
  const appView = useEditorStore((state) => state.appView)
  const cloudStatus = useCloudAuthStore((state) => state.status)
  const teamGate = isTeamCloudApp() && cloudStatus !== 'signed-in'

  if (!booted) {
    return (
      <main
        aria-busy="true"
        className="flex h-full items-center justify-center bg-[#0f0f11] text-sm text-ink-dim"
      >
        Loading projects…
      </main>
    )
  }

  // Settings lives at the root so "Open Settings" works from every view.
  const workspace = teamGate ? 'projects' : resolveWorkspace(appView)
  let body: ReactNode
  switch (workspace) {
    case 'projects':
      body = <ProjectsWorkspace />
      break
    case 'editor':
      body = <EditorWorkspace />
      break
    default: {
      const _never: never = workspace
      body = _never
    }
  }

  return (
    <>
      {body}
      <SettingsDialog />
      <SaveConflictDialog />
    </>
  )
}
