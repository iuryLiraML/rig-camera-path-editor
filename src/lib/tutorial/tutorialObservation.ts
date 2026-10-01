import { planFromJSON, planRooms, openingIssue, type PlanState } from '../floorPlanModel'
import { useCameraOptionsStore } from '../../state/useCameraOptionsStore'
import { useEditorStore } from '../../state/useEditorStore'
import { usePathStore, CAMERA_PATH_ID } from '../../state/usePathStore'
import { useProjectStore } from '../../state/useProjectStore'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore } from '../../state/useSceneStore'
import { isTutorialProgressV2, type TutorialProgressV2 } from './tutorialProgress'
import { recordObservedTutorialAction } from './tutorialActions'

interface PlanBaseline {
  assetId: string
  signature: string
}

interface FigureBaseline {
  id: string
  transform: string
  pose: string
}

interface ScenePlanBaseline {
  id: string
  signature: string
}

let installed = false
let planBaseline: PlanBaseline | undefined
let figureBaseline: FigureBaseline | undefined
let scenePlanBaseline: ScenePlanBaseline | undefined
let timingKey = ''
let durationWasSet = false
let timeWasScrubbed = false

function currentProgress(): TutorialProgressV2 | undefined {
  const progress = useProjectStore.getState().workflow.tutorial
  const activeSceneId = useProjectStore.getState().activeSceneId
  return isTutorialProgressV2(progress) && progress.active
    && (!activeSceneId || activeSceneId === progress.sceneId)
    ? progress
    : undefined
}

function planSignature(plan: Pick<PlanState, 'walls' | 'openings'>): string {
  return JSON.stringify({ walls: plan.walls, openings: plan.openings })
}

function record(actionId: string, kind: string, subjectId?: string, signature?: string) {
  const progress = currentProgress()
  if (!progress) return
  recordObservedTutorialAction(actionId, {
    kind,
    sceneId: progress.sceneId,
    ...(subjectId ? { subjectId } : {}),
    ...(signature ? { signature } : {}),
  })
}

export function registerTutorialPlanBaseline(assetId: string, plan: Pick<PlanState, 'walls' | 'openings'>) {
  planBaseline = { assetId, signature: planSignature(plan) }
}

/** A Plan counts as practiced only after its valid edit has been saved to Library. */
export function observeTutorialPlanSaved(assetId: string, plan: PlanState) {
  const progress = currentProgress()
  if (!progress || progress.artifacts.planAssetId !== assetId) return
  const signature = planSignature(plan)
  if (planBaseline?.assetId === assetId && planBaseline.signature !== signature && planRooms(plan.walls).length > 0) {
    record('room.edit', 'saved-enclosed-room-edit', assetId, signature)
  }
  const validDoor = plan.openings.find((opening) => opening.kind === 'door' && openingIssue(plan, opening) === null)
  if (validDoor) record('room.door', 'saved-hosted-door', validDoor.id, signature)
}

/** Record a Scene Plan edit only after its history transaction has committed. */
export function observeTutorialScenePlanCommitted(objectId: string) {
  const progress = currentProgress()
  if (!progress || progress.currentActionId !== 'room.scene-edit' || progress.artifacts.planObjectId !== objectId) return
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId && item.plan)
  if (!object?.plan) return
  const signature = planSignature(planFromJSON(object.plan))
  if (scenePlanBaseline?.id === objectId && scenePlanBaseline.signature !== signature) {
    record('room.scene-edit', 'edited-scene-plan-copy', objectId, signature)
    scenePlanBaseline = { id: objectId, signature }
  }
}

/** The authored shot identity used to invalidate an old review/export. */
export function tutorialShotSignature(): string {
  const progress = currentProgress()
  const rig = useRigStore.getState()
  const camera = useCameraOptionsStore.getState()
  const path = usePathStore.getState().paths.find((candidate) => candidate.id === (progress?.artifacts.pathId ?? CAMERA_PATH_ID))
  return JSON.stringify({
    sceneId: progress?.sceneId ?? useProjectStore.getState().activeSceneId,
    cameraId: camera.activeOptionId,
    pathId: path?.id,
    anchors: path?.anchors.map((anchor) => anchor.position),
    closed: path?.closed,
    cameraKind: rig.cameraKind,
    cameraPathId: rig.cameraPathId,
    pathSpace: rig.pathSpace,
    duration: rig.duration,
    fov: rig.fov,
    fovKeys: rig.fovKeys,
    target: rig.target,
  })
}

export function registerTutorialFigure(id: string) {
  const figure = useSceneStore.getState().objects.find((object) => object.id === id && object.rigKind === 'dummy')
  const progress = currentProgress()
  if (!figure || !progress) return
  if (progress.currentActionId === 'figure.add') {
    const project = useProjectStore.getState()
    project.setWorkflow({
      ...project.workflow,
      tutorial: { ...progress, artifacts: { ...progress.artifacts, figureId: id } },
    })
    record('figure.add', 'added-bound-figure', id)
    useEditorStore.getState().setShowAddDrawer(false)
  }
  figureBaseline = {
    id,
    transform: JSON.stringify(figure.transform),
    pose: JSON.stringify({ bonePose: figure.bonePose, boneTranslate: figure.boneTranslate, playClips: figure.playClips }),
  }
}

function observeSceneObjects() {
  const progress = currentProgress()
  if (!progress) return
  const objects = useSceneStore.getState().objects
  const planId = progress.artifacts.planObjectId
  const scenePlan = planId ? objects.find((object) => object.id === planId && object.plan) : undefined
  if (progress.currentActionId === 'room.scene-edit' && scenePlan?.plan) {
    const signature = planSignature(planFromJSON(scenePlan.plan))
    const previous = progress.actions['room.scene-edit']?.evidence?.signature
    if (previous && previous !== signature) {
      const project = useProjectStore.getState()
      const { ['room.scene-edit']: _removed, ...actions } = progress.actions
      project.setWorkflow({ ...project.workflow, tutorial: { ...progress, actions } })
      scenePlanBaseline = { id: scenePlan.id, signature }
      return
    }
    if (!scenePlanBaseline || scenePlanBaseline.id !== scenePlan.id) {
      scenePlanBaseline = { id: scenePlan.id, signature }
    }
  } else {
    scenePlanBaseline = undefined
  }
  if (progress.currentActionId === 'navigate.recover' && progress.artifacts.practiceCubeId
    && !objects.some((object) => object.id === progress.artifacts.practiceCubeId)) {
    record('navigate.recover', 'removed-named-practice-cube', progress.artifacts.practiceCubeId)
  }
  const id = progress.artifacts.figureId
  const figure = id ? objects.find((object) => object.id === id && object.rigKind === 'dummy') : undefined
  if (!figure || !id) return
  if (!figureBaseline || figureBaseline.id !== id) {
    figureBaseline = {
      id,
      transform: JSON.stringify(figure.transform),
      pose: JSON.stringify({ bonePose: figure.bonePose, boneTranslate: figure.boneTranslate, playClips: figure.playClips }),
    }
    return
  }
  if (progress.currentActionId === 'figure.place' && JSON.stringify(figure.transform) !== figureBaseline.transform) {
    record('figure.place', 'transformed-bound-figure', id)
  }
  const pose = JSON.stringify({ bonePose: figure.bonePose, boneTranslate: figure.boneTranslate, playClips: figure.playClips })
  if (progress.currentActionId === 'figure.pose' && pose !== figureBaseline.pose && figure.playClips === false) {
    record('figure.pose', 'posed-bound-figure', id)
  }
}

function observeCameraOptions() {
  const progress = currentProgress()
  if (!progress || progress.currentActionId !== 'camera.select' || !progress.artifacts.cameraOptionId) return
  const state = useCameraOptionsStore.getState()
  const selected = state.options.find((option) => option.id === state.activeOptionId)
  if (selected?.id === progress.artifacts.cameraOptionId && selected.name.trim().toLowerCase() === 'room entrance') {
    record('camera.select', 'renamed-active-camera-option', selected.id)
  }
}

function observePath() {
  const progress = currentProgress()
  if (!progress) return
  const path = usePathStore.getState().paths.find((candidate) => candidate.id === CAMERA_PATH_ID)
  if (!path || path.anchors.length < 2 || path.closed) return
  const rig = useRigStore.getState()
  if (progress.currentActionId === 'camera.path' && rig.cameraKind === 'path' && rig.cameraPathId === CAMERA_PATH_ID
    && rig.pathSpace === 'world' && useEditorStore.getState().tool !== 'pen') {
    if (progress.artifacts.pathId !== CAMERA_PATH_ID) {
      const project = useProjectStore.getState()
      project.setWorkflow({
        ...project.workflow,
        tutorial: isTutorialProgressV2(project.workflow.tutorial)
          ? { ...project.workflow.tutorial, artifacts: { ...project.workflow.tutorial.artifacts, pathId: CAMERA_PATH_ID } }
          : project.workflow.tutorial,
      })
    }
    const startingHeights = path.anchors.map((anchor) => ({ id: anchor.id, y: anchor.position[1] }))
    record('camera.path', 'finished-open-camera-path', CAMERA_PATH_ID, JSON.stringify(startingHeights))
  }
  const pathEvidence = progress.actions['camera.path']?.evidence
  let startingHeights: Map<string, number> | undefined
  if (pathEvidence?.kind === 'finished-open-camera-path' && pathEvidence.signature) {
    try {
      const decoded: unknown = JSON.parse(pathEvidence.signature)
      if (Array.isArray(decoded)) {
        startingHeights = new Map(decoded.flatMap((entry) =>
          entry && typeof entry === 'object'
          && typeof (entry as { id?: unknown }).id === 'string'
          && typeof (entry as { y?: unknown }).y === 'number'
            ? [[(entry as { id: string }).id, (entry as { y: number }).y] as const]
            : [],
        ))
      }
    } catch {
      startingHeights = undefined
    }
  }
  if (progress.currentActionId === 'camera.height' && rig.cameraPathId === CAMERA_PATH_ID
    && rig.pathSpace === 'world' && startingHeights?.size === path.anchors.length
    && path.anchors.every((anchor) => {
      const initialY = startingHeights!.get(anchor.id)
      return initialY !== undefined && anchor.position[1] >= 1 && anchor.position[1] <= 2
        && anchor.position[1] - initialY >= 0.5
    })) {
    record('camera.height', 'raised-camera-path-endpoints', CAMERA_PATH_ID)
  }
}

function observeLensAndTiming(previousRig?: ReturnType<typeof useRigStore.getState>) {
  const progress = currentProgress()
  if (!progress) return
  const rig = useRigStore.getState()
  const key = `${useProjectStore.getState().projectId}:${progress.sceneId}`
  if (timingKey !== key) {
    timingKey = key
    durationWasSet = false
    timeWasScrubbed = false
  }
  if (progress.currentActionId === 'timing.duration') {
    // A saved value is already durable evidence of the requested duration;
    // learners should only need to scrub if six seconds was set earlier.
    if (Math.abs(rig.duration - 6) < 0.01) durationWasSet = true
    if (rig.t > 0.02) timeWasScrubbed = true
  }
  if (progress.currentActionId === 'timing.duration' && previousRig) {
    if (previousRig.duration !== rig.duration && Math.abs(rig.duration - 6) < 0.01) durationWasSet = true
    if (previousRig.t !== rig.t && rig.t > 0.02) timeWasScrubbed = true
    if (durationWasSet && timeWasScrubbed) record('timing.duration', 'set-six-seconds-and-scrubbed', progress.artifacts.cameraOptionId, 'duration=6;playhead-moved')
  }
  if (progress.currentActionId === 'timing.lens') {
    const keys = [...rig.fovKeys].sort((a, b) => a.time - b.time)
    const start = keys.find((item) => item.time <= 0.02 && Math.abs(item.value - 45) <= 2)
    const end = keys.find((item) => item.time >= 0.98 && Math.abs(item.value - 40) <= 2)
    if (start && end && start !== end && rig.cameraKind === 'path' && rig.cameraPathId === CAMERA_PATH_ID) {
      record('timing.lens', 'keyed-camera-fov-at-both-ends', progress.artifacts.cameraOptionId, JSON.stringify([start, end]))
    }
  }
}

function scan(previousRig?: ReturnType<typeof useRigStore.getState>) {
  observeSceneObjects()
  observeCameraOptions()
  observePath()
  observeLensAndTiming(previousRig)
}

/** Keep the lesson tied to live store outcomes; safe to call on every app mount. */
export function ensureTutorialObservation() {
  if (installed) return
  installed = true
  useSceneStore.subscribe(() => scan())
  useEditorStore.subscribe(() => scan())
  useCameraOptionsStore.subscribe(() => scan())
  usePathStore.subscribe(() => scan())
  useRigStore.subscribe((_state, previous) => scan(previous))
  useProjectStore.subscribe(() => scan())
  scan()
}
