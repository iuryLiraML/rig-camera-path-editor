import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '../../state/useProjectStore'
import { useEditorStore, type AppView } from '../../state/useEditorStore'
import { useSceneStore } from '../../state/useSceneStore'
import { useCameraOptionsStore } from '../../state/useCameraOptionsStore'
import { usePathStore } from '../../state/usePathStore'
import { useRigStore } from '../../state/useRigStore'
import { layoutTier } from '../../lib/chromeLayout'
import { goLibrary, goProjects, switchProject } from '../../lib/projects'
import { goPlan, leavePlan } from '../../lib/planEditor'
import { TUTORIAL_ACTIONS, TUTORIAL_CHAPTERS, TUTORIAL_STEPS } from '../../lib/tutorial/steps'
import { TUTORIAL_ANCHORS } from '../../lib/tutorial/anchors'
import { placePopover, sameRect, type Rect } from '../../lib/tutorial/coachmarkPlacement'
import {
  advanceStep,
  advanceTutorialAction,
  backStep,
  backTutorialAction,
  confirmTutorialAction,
  getTutorial,
  pauseTutorial,
  resumeTutorial,
  skipTutorial,
} from '../../lib/tutorial/tutorialActions'
import { evaluateTutorialAction } from '../../lib/tutorial/tutorialEvaluation'
import { ensureTutorialObservation, tutorialShotSignature } from '../../lib/tutorial/tutorialObservation'
import { isLegacyTutorialProgress, isTutorialProgressV2, type TutorialProgressV2 } from '../../lib/tutorial/tutorialProgress'
import { useSafeAreaInsets } from '../safeAreaInsets'
import { GUTTER, PHONE_TASK_BAR_HEIGHT, useViewportInsets, useWindowSize } from '../viewportInsets'
import { TutorialInputHints } from './TutorialInputHints'

/**
 * Interactive guided-tutorial coachmark (issue #78). Dims the page, spotlights the
 * exact control the current step teaches, and anchors a small popover (progress
 * dots + title + body + Back / Continue / Pause / close) beside it — pointing where to
 * click, like a product tour. Doing the real action auto-advances (detectors in
 * steps.ts); progress persists in workflow.tutorial. Hidden during playback and
 * recording; falls back to a centered card for steps with no single target, a
 * momentarily-missing target, or when no side has room (never overlapping the
 * control's side).
 */

const PAD = 6 // padding around the highlighted control

/** Track a control's viewport rect through mounts, scroll, and resize. */
function useTargetRect(selector: string | null, stepIndex: number): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)
  useEffect(() => {
    if (!selector) {
      setRect((prev) => (prev === null ? prev : null))
      return
    }
    let raf = 0
    let frames = 0
    const measure = () => {
      const el = document.querySelector(selector)
      if (!el) {
        setRect((prev) => (prev === null ? prev : null))
        return
      }
      const r = el.getBoundingClientRect()
      const next = { left: r.left, top: r.top, width: r.width, height: r.height }
      setRect((prev) => (sameRect(prev, next) ? prev : next))
    }
    // Settle loop: re-measure for ~1s so panels that slide in after setup() are
    // caught even before the observers below fire.
    const tick = () => {
      measure()
      frames += 1
      if (frames < 60) raf = requestAnimationFrame(tick)
    }
    tick()
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    const mo = new MutationObserver(measure)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [selector, stepIndex])
  return rect
}

export function TutorialCoachmark() {
  const tutorial = useProjectStore((s) => s.workflow.tutorial)
  useEffect(() => ensureTutorialObservation(), [])
  if (isLegacyTutorialProgress(tutorial)) return <LegacyTutorialCoachmark />
  if (isTutorialProgressV2(tutorial)) return <PracticalTutorialCoachmark />
  return null
}

function LegacyTutorialCoachmark() {
  const tutorial = useProjectStore((s) => s.workflow.tutorial)
  const projectId = useProjectStore((s) => s.projectId)
  const playMode = useEditorStore((s) => s.playMode)
  const recording = useEditorStore((s) => s.recording)
  const safe = useSafeAreaInsets()
  const win = useWindowSize()

  const legacy = isLegacyTutorialProgress(tutorial)
  const active = Boolean(legacy && tutorial.active && !tutorial.done)
  const stepIndex = legacy ? tutorial.stepIndex : 0
  const step = TUTORIAL_STEPS[stepIndex]
  const anchor = step ? TUTORIAL_ANCHORS[step.id] : undefined

  // Frontier: doing the action auto-advances only at the furthest step reached,
  // so stepping Back to review a finished step never bounces forward. Reset per
  // project (a replay starts fresh).
  const frontier = useRef(stepIndex)
  useEffect(() => {
    const current = useProjectStore.getState().workflow.tutorial
    frontier.current = isLegacyTutorialProgress(current) ? current.stepIndex : 0
  }, [projectId])
  if (stepIndex > frontier.current) frontier.current = stepIndex

  // Reveal the current step's control (navigate / open the panel / arm the tool).
  useEffect(() => {
    if (!active || !anchor) return
    anchor.setup()
  }, [active, stepIndex, projectId, anchor])

  // Auto-advance when the current (frontier) step's real artefact appears.
  useEffect(() => {
    if (!active || playMode || recording) return
    const check = () => {
      const t = getTutorial()
      if (!isLegacyTutorialProgress(t) || !t.active || t.done) return
      if (t.stepIndex < frontier.current) return
      const current = TUTORIAL_STEPS[t.stepIndex]
      if (current && current.id !== 'welcome' && current.isDone()) advanceStep()
    }
    const unsubs = [
      useSceneStore.subscribe(check),
      useCameraOptionsStore.subscribe(check),
      usePathStore.subscribe(check),
      useEditorStore.subscribe(check),
      useRigStore.subscribe(check),
    ]
    check()
    return () => unsubs.forEach((u) => u())
  }, [active, playMode, recording])

  // Only observe a target while the tour is actually showing this step.
  const visible = active && !playMode && !recording
  const selector = visible && anchor ? anchor.selector : null
  const rect = useTargetRect(selector, stepIndex)

  const popRef = useRef<HTMLDivElement>(null)
  const [popSize, setPopSize] = useState({ w: 320, h: 168 })
  useLayoutEffect(() => {
    const el = popRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPopSize((p) =>
      Math.abs(p.w - r.width) < 1 && Math.abs(p.h - r.height) < 1 ? p : { w: r.width, h: r.height },
    )
  }, [stepIndex, win.w, win.h])

  if (!visible || !step) return null

  const total = TUTORIAL_STEPS.length
  const showSpotlight = Boolean(anchor && anchor.placement !== 'center' && rect)
  const placed = showSpotlight ? placePopover(rect!, popSize, anchor!.placement, safe, win.w, win.h) : null
  // Centered when there is no target, or no side has room (never overlap the control's side).
  const centered = !placed || !placed.fits
  const done = step.id !== 'welcome' && step.isDone()

  const popoverStyle: React.CSSProperties = centered
    ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'min(92vw, 380px)' }
    : { left: placed!.left, top: placed!.top, width: 'min(92vw, 320px)' }

  const arrow = placed && placed.fits ? placed : null

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-40">
      {showSpotlight ? (
        <div
          className="absolute"
          style={{
            left: rect!.left - PAD,
            top: rect!.top - PAD,
            width: rect!.width + PAD * 2,
            height: rect!.height + PAD * 2,
            borderRadius: 10,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55), 0 0 0 2px var(--accent)',
            transition: 'left .18s ease, top .18s ease, width .18s ease, height .18s ease',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <div
        ref={popRef}
        role="dialog"
        aria-label="Tutorial"
        className="panel pointer-events-auto absolute p-4 shadow-[0_12px_40px_rgb(0_0_0/0.4)]"
        style={popoverStyle}
      >
        {arrow && (
          <span
            aria-hidden
            className="absolute h-3 w-3 rotate-45 border border-line bg-panel"
            style={
              arrow.side === 'bottom'
                ? { left: arrow.arrowLeft - 6, top: -6, borderRight: 'none', borderBottom: 'none' }
                : arrow.side === 'top'
                  ? { left: arrow.arrowLeft - 6, bottom: -6, borderLeft: 'none', borderTop: 'none' }
                  : arrow.side === 'right'
                    ? { top: arrow.arrowTop - 6, left: -6, borderRight: 'none', borderTop: 'none' }
                    : { top: arrow.arrowTop - 6, right: -6, borderLeft: 'none', borderBottom: 'none' }
            }
          />
        )}

        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-accent">
            Step {stepIndex + 1} of {total}
          </span>
          <div className="ml-1 flex flex-1 items-center gap-1" aria-hidden>
            {TUTORIAL_STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`h-1 flex-1 rounded-full ${i <= stepIndex ? 'bg-accent' : 'bg-panel-3'}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={skipTutorial}
            aria-label="Close tutorial"
            className="flex h-11 w-11 items-center justify-center rounded-md text-ink-dim hover:bg-panel-2 hover:text-ink"
          >
            <span className="text-[15px]">✕</span>
          </button>
        </div>

        <h2 className="text-sm font-semibold text-ink">{step.title}</h2>
        <p className="mt-1.5 text-[13px] leading-5 text-ink-dim">{step.body}</p>
        {done && <p className="mt-2 text-[12px] font-medium text-accent">Done ✓</p>}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={backStep}
            disabled={stepIndex <= 0}
            className={`min-h-[44px] rounded-lg px-3 text-[12px] ${
              stepIndex <= 0
                ? 'cursor-not-allowed text-ink-dim/40'
                : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
            }`}
          >
            Back
          </button>
          <button
            type="button"
            onClick={skipTutorial}
            className="min-h-[44px] rounded-lg px-3 text-[12px] text-ink-dim hover:bg-panel-2 hover:text-ink"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={advanceStep}
            className="ml-auto min-h-[44px] rounded-lg bg-accent px-5 text-[12px] font-medium text-white hover:bg-accent/85"
          >
            {stepIndex >= total - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const PRACTICAL_TARGETS: Record<string, { selector: string; view?: 'library' | 'plan' | 'editor' | 'projects'; mode?: 'build' | 'compose' | 'visualize' }> = {
  'editor.modes': { selector: '[data-tour="mode-switcher"]', view: 'editor', mode: 'build' },
  'viewport.help': { selector: '[data-tour="navigation-help"]', view: 'editor', mode: 'build' },
  'viewport.outliner': { selector: '[data-tour="practice-cube-row"]', view: 'editor', mode: 'build' },
  'library.new-plan': { selector: '[data-tour="library-new-plan"]', view: 'library' },
  'plan.select-tool': { selector: '[data-tour="plan-select"]' },
  'plan.door-tool': { selector: '[data-tour="plan-door"]' },
  'library.insert-plan': { selector: '[data-tour="library-insert-plan"]', view: 'library' },
  'build.scene-plan-edit': { selector: '[data-tour="scene-plan-edit"]', view: 'editor', mode: 'build' },
  'build.figures': { selector: '[data-tour="figures-drawer"]', view: 'editor', mode: 'build' },
  'build.transform': { selector: '[data-tour="object-transform"]', view: 'editor', mode: 'build' },
  'figure.pose-controls': { selector: '[data-tour="figure-pose"]', view: 'editor', mode: 'build' },
  'compose.camera': { selector: '[data-tour="mode-compose"]', view: 'editor', mode: 'compose' },
  'compose.camera-row': { selector: '[data-tour="tutorial-camera-option"]', view: 'editor', mode: 'compose' },
  'compose.pen': { selector: '[data-tour="pen-tool"]', view: 'editor', mode: 'compose' },
  'compose.path-height': { selector: '[data-tour="path-height"]', view: 'editor', mode: 'compose' },
  'compose.camera-target': { selector: '[data-tour="camera-target"]', view: 'editor', mode: 'compose' },
  'compose.timeline': { selector: '[data-testid="shot-duration"]', view: 'editor', mode: 'compose' },
  'compose.fov-key': { selector: '[data-tour="camera-fov"]', view: 'editor', mode: 'compose' },
  'visualize.preview': { selector: '[data-tour="mode-visualize"]', view: 'editor', mode: 'visualize' },
  'visualize.export': { selector: '[data-tour="visualize-export-settings"]', view: 'editor', mode: 'visualize' },
  'projects.tutorial': { selector: '[data-project-id]', view: 'projects' },
}

// Views a lesson step can live on. Steps move between the editor, the Plan
// editor, the Library and the Projects list, so any of these can legitimately
// host the coachmark. 'home' and 'board' are never part of a lesson — landing
// there means the learner has stepped out, and the card collapses to a pill.
const LESSON_VIEWS = new Set<AppView>(['editor', 'plan', 'library', 'projects'])

function PracticalTutorialCoachmark() {
  const progress = useProjectStore((s) => isTutorialProgressV2(s.workflow.tutorial) ? s.workflow.tutorial : undefined)
  const activeSceneId = useProjectStore((s) => s.activeSceneId)
  const projectId = useProjectStore((s) => s.projectId)
  const appView = useEditorStore((s) => s.appView)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const activeTaskPanel = useEditorStore((s) => s.activeTaskPanel)
  const playMode = useEditorStore((s) => s.playMode)
  const recording = useEditorStore((s) => s.recording)
  const safe = useSafeAreaInsets()
  const insets = useViewportInsets()
  const win = useWindowSize()
  const [collapsed, setCollapsed] = useState(false)
  const [targetNonce, setTargetNonce] = useState(0)
  const action = progress ? TUTORIAL_ACTIONS.find((item) => item.id === progress.currentActionId) : undefined
  const openedWorkspaceAction = useRef<string | null>(null)
  const phone = layoutTier(win.w, win.h) === 'phone'
  // Task sheets own the touch surface while open. Keeping the lesson card
  // mounted over them makes its footer intercept toolbar and inspector taps;
  // the card returns as soon as the learner dismisses the sheet.
  const phoneTaskOpen = phone && appView === 'editor' && activeTaskPanel !== 'none'
  // A full-height lesson card can cover the target inside a phone task sheet.
  // Start compact there; the learner can expand it again without losing progress.
  useEffect(() => setCollapsed(phone), [action?.id, phone])
  // Creating a Plan begins in the account-level Library, not in the active
  // editor mode. Take the learner there as soon as this action starts; the
  // button remains available as a recovery route if saving cannot complete.
  useEffect(() => {
    if (!progress?.active || action?.id !== 'room.create') {
      openedWorkspaceAction.current = null
      return
    }
    if (appView === 'library' || openedWorkspaceAction.current === action.id) return
    openedWorkspaceAction.current = action.id
    void goLibrary()
  }, [action?.id, appView, progress?.active])
  useEffect(() => {
    if (!progress?.active || action?.id !== 'room.scene-edit' || !progress.artifacts.planObjectId) return
    const editor = useEditorStore.getState()
    editor.setAppView('editor')
    editor.setWorkspaceMode('build')
    editor.select(`obj:${progress.artifacts.planObjectId}`)
    editor.setActiveTaskPanel('director')
  }, [action?.id, progress?.active, progress?.artifacts.planObjectId])
  // Bring the Plan editor (room.edit / room.door) or the Library (room.insert)
  // to the front when the learner lands on that step from elsewhere — e.g.
  // pressed Continue without opening it. Editor steps and room.create have their
  // own effects above. Fires once per action visit (the ref guard) so it never
  // yanks the learner back after they deliberately navigate away, never bounces
  // them out of a surface they are already on, and never forces the Plan open
  // when no Plan was created (that step shows its skipped-prerequisite guidance).
  const autoOpenedAction = useRef<string | null>(null)
  useEffect(() => {
    if (!progress?.active || !action) {
      autoOpenedAction.current = null
      return
    }
    if (autoOpenedAction.current === action.id) return
    // Handle each action exactly once, on arrival. Marking it here (before the
    // navigation checks) is what keeps this from re-firing when the learner
    // later navigates away on their own — otherwise leaving a Plan step for Home
    // would immediately yank them back into the Plan editor.
    autoOpenedAction.current = action.id
    if ((action.id === 'room.edit' || action.id === 'room.door') && appView !== 'plan' && progress.artifacts.planAssetId) {
      void goPlan(progress.artifacts.planAssetId)
    } else if (action.id === 'room.insert' && appView !== 'library') {
      void goLibrary()
    }
  }, [action?.id, progress?.active, appView, progress?.artifacts.planAssetId])
  const chapterIndex = action ? TUTORIAL_CHAPTERS.findIndex((chapter) => chapter.actions.some((item) => item.id === action.id)) : -1
  const phoneNavigation = action?.id === 'navigate.view' && phone
  const target = action?.target && !phoneNavigation ? PRACTICAL_TARGETS[action.target] : undefined
  const targetSelector = action?.id === 'finish.return'
    ? `[data-project-id="${projectId}"]`
    : target?.selector ?? null
  const layoutKey = `${appView}:${workspaceMode}:${targetNonce}`
  const rect = useVisibleTargetRect(targetSelector, `${action?.id ?? ''}:${layoutKey}`)

  // A phone task sheet opens automatically for the current action. Keep the
  // workspace mode in sync with that action so its controls are actually
  // present (for example, Top and Pen for the camera-path lesson).
  useEffect(() => {
    if (!progress?.active || !target || target.view !== 'editor') return
    const editor = useEditorStore.getState()
    if (editor.appView !== 'editor') editor.setAppView('editor')
    if (target.mode && editor.workspaceMode !== target.mode) editor.setWorkspaceMode(target.mode)
  }, [action?.id, progress?.active, target?.mode, target?.view])

  if (!progress) return null
  if (phoneTaskOpen) return null
  if (progress.done) {
    const bottom = phone ? safe.bottom + PHONE_TASK_BAR_HEIGHT + 2 * GUTTER : GUTTER
    return <TutorialSummary progress={progress} bottom={bottom} />
  }
  if (!progress.active) {
    return (
      <div className="fixed bottom-3 left-3 z-40 flex items-center gap-3 rounded-xl border border-line bg-panel/95 px-3 py-2 text-xs shadow-xl backdrop-blur" role="status">
        <span>Tutorial paused · {Object.values(progress.actions).filter((item) => item.status === 'practiced').length} practiced</span>
        <button type="button" onClick={resumeTutorial} className="min-h-11 rounded-lg bg-accent px-3 font-medium text-white">Resume</button>
      </div>
    )
  }
  if (!action || playMode || recording) return null

  const currentScene = activeSceneId === progress.sceneId
  const shotSignature = action.id === 'finish.review' || action.id === 'finish.export' ? tutorialShotSignature() : undefined
  const evaluation = evaluateTutorialAction(action.id, progress, {
    sceneId: currentScene ? activeSceneId : '',
    // Confirmation actions are deliberate learner acknowledgements after a
    // preview or review. Their target may live in a closed phone sheet, so
    // target visibility must not disable the confirmation button.
    availability: action.completion === 'confirmation' || !target || rect ? 'ready' : 'unavailable',
    unavailableReason: 'Open the workspace shown in this action to reveal its control.',
  })
  const status = progress.actions[action.id]?.status
  const touchInput = typeof navigator !== 'undefined' && (
    navigator.maxTouchPoints > 0 ||
    (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true)
  )
  const instruction = touchInput && action.touchInstruction
    ? action.touchInstruction
    : action.instruction
  const hints = touchInput
    ? action.touchHints ?? [{ label: 'Use the highlighted control', input: 'touch' as const, gesture: 'Tap' }]
    : action.hints
  // Whether the learner has finished this action — drives only the "done"
  // feedback and whether the confirmation button still shows. Continue no
  // longer depends on it; the learner may advance whenever they like.
  const actionDone = status === 'practiced' || status === 'confirmed' || status === 'skipped'
  const canAcknowledge = action.completion === 'confirmation' && evaluation.state === 'ready' && currentScene && status !== 'skipped'
  const pendingRequirement = !status && action.completion === 'practice' && evaluation.state === 'ready'
    ? action.completionHint
    : undefined
  const targetPlacement = rect && target
    ? placePopover(rect, { w: 350, h: collapsed ? 60 : hints?.length || pendingRequirement ? 470 : 264 }, 'top', {
        top: Math.max(safe.top, insets.top),
        right: Math.max(safe.right, win.w - insets.right),
        bottom: Math.max(safe.bottom, win.h - insets.contentBottom),
        left: Math.max(safe.left, insets.left),
      }, win.w, win.h)
    : null
  const anchored = Boolean(targetPlacement?.fits)
  const maxCardHeight = Math.max(180, win.h - Math.max(safe.top, insets.top) - Math.max(safe.bottom, insets.contentBottom) - 24)
  const boundsStyle: React.CSSProperties = anchored
    ? { left: targetPlacement!.left, top: targetPlacement!.top, width: 'min(92vw, 350px)' }
    : {
        left: Math.max(insets.left, 12),
        bottom: Math.max(insets.contentBottom + 12, safe.bottom + 12),
        width: `min(92vw, 620px, ${Math.max(280, insets.right - insets.left)}px)`,
      }

  const openTarget = () => {
    if (!target) return
    if ((action.id === 'room.edit' || action.id === 'room.door') && progress.artifacts.planAssetId) {
      void goPlan(progress.artifacts.planAssetId)
      setTargetNonce((value) => value + 1)
      return
    }
    if (action.id === 'room.scene-edit' && progress.artifacts.planObjectId) {
      const editor = useEditorStore.getState()
      editor.setAppView('editor')
      editor.setWorkspaceMode('build')
      editor.select(`obj:${progress.artifacts.planObjectId}`)
      editor.setActiveTaskPanel('director')
      setCollapsed(phone)
      setTargetNonce((value) => value + 1)
      return
    }
    if (target.view === 'library') {
      // room.insert is only marked after the Plan save, so avoid queueing a
      // second thumbnail render while returning to Library for the next step.
      void (appView === 'plan' && action.id !== 'room.insert' ? leavePlan() : goLibrary())
      setCollapsed(phone)
      setTargetNonce((value) => value + 1)
      return
    }
    if (target.view === 'projects') {
      void goProjects()
      setCollapsed(phone)
      setTargetNonce((value) => value + 1)
      return
    }
    if (target.view) useEditorStore.getState().setAppView(target.view)
    if (target.mode) useEditorStore.getState().setWorkspaceMode(target.mode)
    if (action.id === 'navigate.recover' || action.id === 'camera.select') {
      useEditorStore.getState().setShowOutliner(true)
    }
    if (action.id === 'figure.add') useEditorStore.getState().openAddDrawerChip('figures')
    if (action.id === 'figure.pose' && progress.artifacts.figureId) {
      useEditorStore.getState().select(`obj:${progress.artifacts.figureId}`)
    }
    if (action.id === 'camera.height') {
      useEditorStore.getState().select('camera-path')
      usePathStore.getState().selectAnchor(null)
    }
    if (action.id === 'camera.frame' || action.id === 'camera.select' || action.id === 'timing.lens') {
      useEditorStore.getState().select('cinema-camera')
      useEditorStore.getState().setCameraPanel('adjust')
    }
    setCollapsed(phone)
    setTargetNonce((value) => value + 1)
    if (target) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(target.selector)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
    }
  }

  // When the learner has stepped out of the lesson entirely (Home), the full
  // card would float over an unrelated screen. Collapse it to a compact pill
  // that takes them back to the lesson's surface.
  const offLessonSurface = !LESSON_VIEWS.has(appView)
  const returnToLesson = () => {
    if ((action.id === 'room.edit' || action.id === 'room.door') && !progress.artifacts.planAssetId) {
      // No Plan was created, so there is no Plan editor to open; return to the
      // editor base, where the coachmark shows the skipped-prerequisite guidance.
      const editor = useEditorStore.getState()
      editor.setAppView('editor')
      editor.setWorkspaceMode('build')
      return
    }
    openTarget()
  }
  if (offLessonSurface) {
    return (
      <div className="fixed bottom-3 left-3 z-40 flex max-w-[calc(100vw-24px)] items-center gap-3 rounded-xl border border-line bg-panel/95 px-3 py-2 text-xs shadow-xl backdrop-blur" role="status">
        <span className="min-w-0 truncate text-ink-dim"><span className="font-medium text-ink">Lesson:</span> {action.title}</span>
        <button type="button" onClick={returnToLesson} className="min-h-11 shrink-0 rounded-lg bg-accent px-3 font-medium text-white">Return to the lesson</button>
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {anchored && rect && <div aria-hidden className="absolute rounded-lg ring-2 ring-accent" style={{ left: rect.left - 5, top: rect.top - 5, width: rect.width + 10, height: rect.height + 10 }} />}
      <section aria-label="Guided lesson" className="panel pointer-events-auto absolute overflow-y-auto p-3 shadow-[0_12px_40px_rgb(0_0_0/0.4)]" style={{ ...boundsStyle, maxHeight: maxCardHeight }}>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wide text-accent">Chapter {chapterIndex + 1} of 7 · Action {TUTORIAL_ACTIONS.findIndex((item) => item.id === action.id) + 1} of {TUTORIAL_ACTIONS.length}</span>
          <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand lesson instructions' : 'Collapse lesson instructions'} className="flex h-11 w-11 items-center justify-center rounded-md text-ink-dim hover:bg-panel-2 hover:text-ink">{collapsed ? '＋' : '−'}</button>
          <button type="button" onClick={pauseTutorial} aria-label="Pause tutorial" className="flex h-11 w-11 items-center justify-center rounded-md text-ink-dim hover:bg-panel-2 hover:text-ink">✕</button>
        </div>
        {!collapsed && <>
          <h2 className="mt-1 text-sm font-semibold text-ink">{action.title}</h2>
          <p className="mt-1 text-[12px] leading-4 text-ink-dim">{action.why}</p>
          <p className="mt-2 text-[13px] leading-5 text-ink">{instruction}</p>
          {hints && <TutorialInputHints hints={hints} />}
          <p className="mt-2 rounded-md bg-panel-2 px-2 py-1.5 text-[11px] leading-4 text-ink-dim"><span className="font-medium text-ink">Try:</span> {action.action}</p>
          {pendingRequirement && <p role="status" className="mt-2 rounded-md border border-accent/35 bg-accent/10 px-2 py-1.5 text-[11px] leading-4 text-ink"><span className="font-medium text-accent">To practice:</span> {pendingRequirement} <span className="text-ink-dim">Or press Continue to move on.</span></p>}
          {status && <p role="status" className="mt-2 text-[11px] text-accent">{status === 'practiced' ? 'Practice observed' : status === 'confirmed' ? 'You confirmed this action' : 'Action skipped'}</p>}
          {evaluation.state === 'prerequisite' && <p role="status" className="mt-2 text-[11px] text-ink-dim">This builds on “{TUTORIAL_ACTIONS.find((item) => item.id === evaluation.actionId)?.title ?? 'the previous action'}”. Go back to it, or press Continue to move on.</p>}
          {evaluation.state === 'prerequisite-skipped' && <p role="status" className="mt-2 text-[11px] text-ink-dim">An earlier action was skipped. Go back to it, or press Continue to move on.</p>}
          {evaluation.state === 'wrong-scene' && <p role="status" className="mt-2 text-[11px] text-ink-dim">This lesson is attached to another scene. Return to its scene before continuing.</p>}
          {evaluation.state === 'unavailable' && <p role="status" className="mt-2 text-[11px] text-ink-dim">{evaluation.reason}</p>}
          {action.id === 'finish.export' && progress.export.state === 'failed' && <p role="status" className="mt-2 text-[11px] text-ink-dim">The export did not produce a file. Retry it, or press Continue to finish the lesson without a video.</p>}
          {action.id === 'finish.export' && progress.export.state === 'cancelled' && <p role="status" className="mt-2 text-[11px] text-ink-dim">Export cancelled. Retry it, or press Continue to finish the lesson without a video.</p>}
          {action.id === 'finish.export' && progress.export.state === 'unsupported' && <p role="status" className="mt-2 text-[11px] text-ink-dim">Video export is unavailable in this browser. Press Continue to finish without a video file.</p>}
          <p className="mt-2 text-[11px] leading-4 text-ink-dim"><span className="font-medium text-ink">Check:</span> {action.outcome}</p>
          {action.recovery && <details className="mt-2 text-[11px] text-ink-dim"><summary className="cursor-pointer">If it does not work</summary><p className="mt-1 leading-4">{action.recovery}</p></details>}
        </>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
          <button type="button" onClick={backTutorialAction} disabled={TUTORIAL_ACTIONS[0]?.id === action.id} className="min-h-11 rounded-lg px-2 text-[11px] text-ink-dim hover:bg-panel-2 disabled:opacity-40">Back</button>
          <button type="button" onClick={pauseTutorial} className="min-h-11 rounded-lg px-2 text-[11px] text-ink-dim hover:bg-panel-2">Pause lesson</button>
          {target && (!rect || !anchored) && <button type="button" onClick={openTarget} className="min-h-11 rounded-lg border border-line px-2 text-[11px] text-ink hover:bg-panel-2">Open control</button>}
          {action.completion === 'confirmation' && !actionDone && <button type="button" onClick={() => confirmTutorialAction(action.id, progress.sceneId, shotSignature)} disabled={!canAcknowledge} className="ml-auto min-h-11 rounded-lg border border-line px-2 text-[11px] text-ink hover:bg-panel-2 disabled:opacity-40">{action.id === 'navigate.view' ? 'I practiced these controls' : action.id === 'camera.frame' ? 'I checked the shot' : 'I reviewed this'}</button>}
          <button type="button" onClick={advanceTutorialAction} disabled={!currentScene} className="ml-auto min-h-11 rounded-lg bg-accent px-4 text-[11px] font-medium text-white hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-40">{action.id === 'finish.return' ? 'Finish lesson' : 'Continue'}</button>
        </div>
      </section>
    </div>
  )
}

function useVisibleTargetRect(selector: string | null, key: string): Rect | null {
  const [measured, setMeasured] = useState<{ key: string; rect: Rect | null }>({ key, rect: null })
  useEffect(() => {
    setMeasured({ key, rect: null })
    if (!selector) return
    let frame = 0
    let count = 0
    let observer: ResizeObserver | undefined
    const measure = () => {
      const element = document.querySelector<HTMLElement>(selector)
      const box = element?.getBoundingClientRect()
      let left = 0
      let top = 0
      let right = window.innerWidth
      let bottom = window.innerHeight
      let visible = Boolean(element && box && box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden')
      for (let parent = element?.parentElement; visible && parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        const bounds = parent.getBoundingClientRect()
        if (style.overflowX !== 'visible') {
          left = Math.max(left, bounds.left)
          right = Math.min(right, bounds.right)
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, bounds.top)
          bottom = Math.min(bottom, bounds.bottom)
        }
      }
      const clippedLeft = Math.max(left, box?.left ?? 0)
      const clippedTop = Math.max(top, box?.top ?? 0)
      const clippedRight = Math.min(right, box?.right ?? 0)
      const clippedBottom = Math.min(bottom, box?.bottom ?? 0)
      visible = visible && clippedRight > clippedLeft && clippedBottom > clippedTop
      const next = visible
        ? { left: clippedLeft, top: clippedTop, width: clippedRight - clippedLeft, height: clippedBottom - clippedTop }
        : null
      setMeasured((previous) => previous.key === key && sameRect(previous.rect, next)
        ? previous
        : { key, rect: next })
      observer?.disconnect()
      if (element) { observer = new ResizeObserver(measure); observer.observe(element) }
    }
    const settle = () => { measure(); count += 1; if (count < 5) frame = requestAnimationFrame(settle) }
    settle()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('orientationchange', measure)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('orientationchange', measure)
    }
  }, [selector, key])
  return measured.key === key ? measured.rect : null
}

function TutorialSummary({ progress, bottom }: { progress: TutorialProgressV2; bottom: number }) {
  const projectId = useProjectStore((state) => state.projectId)
  const practiced = Object.values(progress.actions).filter((item) => item.status === 'practiced').length
  const confirmed = Object.values(progress.actions).filter((item) => item.status === 'confirmed').length
  const skipped = Object.values(progress.actions).filter((item) => item.status === 'skipped').length
  return (
    <section aria-label="Tutorial summary" style={{ bottom }} className="fixed left-3 z-40 max-h-[calc(100dvh-1.5rem)] max-w-[min(94vw,420px)] overflow-y-auto rounded-xl border border-line bg-panel/95 p-4 shadow-xl backdrop-blur">
      <p className="text-[11px] font-medium uppercase tracking-wide text-accent">Lesson complete</p>
      <h2 className="mt-1 text-sm font-semibold text-ink">Your camera move is ready to revisit</h2>
      <p className="mt-2 text-xs leading-5 text-ink-dim">{practiced} practiced · {confirmed} confirmed · {skipped} skipped · Export: {progress.export.state}</p>
      <p className="mt-2 text-xs leading-5 text-ink-dim">The Tutorial project stays in Projects. You can reopen it or start a separate practice project from Home.</p>
      <button type="button" onClick={() => { void switchProject(projectId).then(() => useEditorStore.getState().setAppView('editor')) }} className="mt-3 min-h-11 rounded-lg bg-accent px-4 text-xs font-medium text-white">Reopen Tutorial</button>
    </section>
  )
}
