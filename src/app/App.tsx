import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { useRigStore } from '../state/useRigStore'
import { usePathStore } from '../state/usePathStore'
import { cameraReady } from '../state/cameraPathLink'
import { editorChrome } from '../lib/workspaceChrome'
import { Viewport } from '../viewport/Viewport'
import { Toolbar } from '../ui/Toolbar'
import { LeftPanel } from '../ui/LeftPanel'
import { DirectorDock } from '../ui/DirectorDock'
import { ViewportFooter } from '../ui/ViewportFooter'
import { Timeline } from '../ui/Timeline'
import { OnboardingCard } from '../ui/OnboardingCard'
import { CameraPreviewFrame } from '../ui/CameraPreviewFrame'
import { CameraRigHud } from '../ui/CameraRigHud'
import { AreaLayer } from '../ui/AreaLayer'
import { SettingsDialog } from '../ui/SettingsDialog'
import { ProjectsWorkspace } from '../ui/ProjectsWorkspace'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { isTeamCloudApp } from '../lib/cloud/client'
import { reloadActiveProjectFromCloud } from '../lib/projects'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import { cancelRecording, isRecording } from '../lib/recorder'
import { redo, undo, historyIsDirty } from '../lib/history'
import { insertKeyframeAtPlayhead } from '../lib/insertKeyframe'
import {
  applyDeleteShortcut,
  applyHelpShortcut,
  applySaveShortcut,
  applyTimelineShortcut,
  isKeyableField,
  isKeyableShortcut,
  isTextEditing,
} from '../lib/editorShortcuts'
import { applyTogglePlayback } from '../lib/playback'
import { importDroppedModels, openDenseImportQueue, undoLastMeshRevision } from '../lib/sceneIO'
import { useProjectStore } from '../state/useProjectStore'
import { resolveWorkspace } from './resolveWorkspace'
import { ModeSwitcher } from '../ui/ModeSwitcher'
import { ProjectChip } from '../ui/ProjectChip'
import { AddObjectDrawer } from '../ui/AddObjectDrawer'
import { ObjectBar } from '../ui/ObjectBar'
import { NavLegend } from '../ui/NavLegend'
import { ImportAssetsModal } from '../ui/ImportAssetsModal'
import { CameraBar } from '../ui/CameraBar'
import { CameraAdjustPanel } from '../ui/CameraAdjustPanel'
import { SequenceStrip } from '../ui/SequenceStrip'
import { ShortcutsOverlay } from '../ui/ShortcutsOverlay'

function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const editor = useEditorStore.getState()
      const rig = useRigStore.getState()
      const path = usePathStore.getState()

      if (applySaveShortcut(e)) return
      if (editor.showShortcuts && e.key === 'Escape') {
        e.preventDefault()
        editor.setShowShortcuts(false)
        return
      }
      if (isTextEditing()) return
      if (applyHelpShortcut(e) || applyTimelineShortcut(e)) return
      if (isKeyableField() && !isKeyableShortcut(e.key)) return

      // looking through a free camera: WASD/QE fly — don't steal them for gizmos
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
        if (e.shiftKey) {
          redo()
        } else {
          const objectId = editor.selection?.startsWith('obj:') ? editor.selection.slice(4) : null
          if (historyIsDirty()) undo()
          else if (!undoLastMeshRevision(objectId)) undo()
        }
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
          if (!editor.playMode && editor.workspaceMode === 'compose') editor.setTool('pen')
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
        case 'h':
        case 'H':
        case 'Home':
          e.preventDefault()
          editor.requestHome()
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
          } else if (editor.showImportModal) {
            editor.setShowImportModal(false)
          } else if (editor.showAddDrawer) {
            editor.setShowAddDrawer(false)
          } else if (editor.objectBarPanel !== 'none') {
            editor.setObjectBarPanel('none')
          } else if (editor.cameraPanel !== 'closed') {
            editor.setCameraPanel('closed')
          } else if (editor.directorExpanded) {
            editor.setDirectorExpanded(false)
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
          if (applyDeleteShortcut(e.key)) e.preventDefault()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** Keep Compose docks mounted after the first visit so Build ↔ Compose does not freeze on remount. */
function KeepMounted({ show, children }: { show: boolean; children: ReactNode }) {
  const seen = useRef(show)
  if (show) seen.current = true
  if (!seen.current) return null
  return (
    <div hidden={!show} className={show ? undefined : 'pointer-events-none'}>
      {children}
    </div>
  )
}

function EditorWorkspace() {
  const notice = useSceneStore((s) => s.notice)
  const importing = useSceneStore((s) => s.importing)
  const showNotice = useSceneStore((s) => s.showNotice)
  const playMode = useEditorStore((s) => s.playMode)
  const recording = useEditorStore((s) => s.recording)
  const recordingKind = useEditorStore((s) => s.recordingKind)
  const recordProgress = useEditorStore((s) => s.recordProgress)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const composeDock = useEditorStore((s) => s.composeDock)
  const showOutliner = useEditorStore((s) => s.showOutliner)
  const showAddDrawer = useEditorStore((s) => s.showAddDrawer)
  const chrome = editorChrome({
    playMode,
    workspaceMode,
    composeDock,
    showOutliner,
    showAddDrawer,
  })
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
    void importDroppedModels(models).then((heavies) => openDenseImportQueue(heavies))
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <Viewport />

      <AreaLayer />

      {chrome.toolbar && (
        <>
          <ProjectChip />
          <ModeSwitcher />
          <Toolbar />
        </>
      )}
      {chrome.outliner && <LeftPanel />}
      {chrome.directorDock && <DirectorDock />}
      <KeepMounted show={chrome.timeline}>
        <Timeline />
      </KeepMounted>
      <KeepMounted show={chrome.sequence}>
        <SequenceStrip />
      </KeepMounted>
      <KeepMounted show={chrome.footer}>
        <ViewportFooter center={chrome.cameraBar ? <CameraBar embedded /> : null} />
      </KeepMounted>
      {chrome.navLegend && <NavLegend />}
      {chrome.onboarding && <OnboardingCard />}
      <KeepMounted show={chrome.pip}>
        <CameraPreviewFrame />
      </KeepMounted>
      <KeepMounted show={chrome.cameraHud}>
        <CameraRigHud />
      </KeepMounted>
      <KeepMounted show={chrome.cameraBar && !chrome.footer}>
        <CameraBar />
      </KeepMounted>
      <KeepMounted show={chrome.cameraBar}>
        <CameraAdjustPanel />
      </KeepMounted>
      {chrome.objectBar && <ObjectBar />}
      {chrome.addDrawer && <AddObjectDrawer />}
      <ImportAssetsModal />
      <ShortcutsOverlay />

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
          {recordingKind === 'still' ? (
            <>Capturing still…</>
          ) : Number.isNaN(recordProgress) ? (
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
