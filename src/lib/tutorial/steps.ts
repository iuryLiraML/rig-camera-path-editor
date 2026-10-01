import { useSceneStore } from '../../state/useSceneStore'
import { useCameraOptionsStore } from '../../state/useCameraOptionsStore'
import { usePathStore } from '../../state/usePathStore'
import { useEditorStore } from '../../state/useEditorStore'
import { CHANNEL_FIELD, useRigStore } from '../../state/useRigStore'
import { KEY_CHANNELS } from '../keyAtPlayhead'

/**
 * The seven guided-tutorial steps (issue #78). Each step teaches one real action
 * and detects the resulting artefact from live store state. Detectors are
 * absolute against the clean seed (box + plane, one camera, no path, no keys), so
 * an unrelated default artefact cannot satisfy another step. Where a step points
 * the user (the highlighted control + how it is revealed) lives in `anchors.ts`.
 */
export interface TutorialStep {
  /** Stable id (persisted only as an index; id keys the anchor + is used in tests). */
  id: string
  title: string
  body: string
  /** True once the step's real artefact exists. Welcome has none (advance via Next). */
  isDone: () => boolean
}

function hasAnyRigKey(): boolean {
  const rig = useRigStore.getState()
  return KEY_CHANNELS.some((channel) => {
    if (channel === 'progress') return rig.progressKeys.length > 0
    const arr = rig[CHANNEL_FIELD[channel]] as { length: number } | undefined
    return Boolean(arr && arr.length > 0)
  })
}

function activePathAnchorCount(): number {
  const path = usePathStore.getState()
  return path.paths.find((p) => p.id === path.activePathId)?.anchors.length ?? 0
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Rig',
    body:
      "This quick tour builds a first scene and a camera move. We'll highlight what to click at each step. Your other projects stay untouched — use Next, Back, or Skip anytime.",
    isDone: () => false,
  },
  {
    id: 'plan',
    title: 'Add a floor plan',
    body:
      'Click New floor plan to create a reusable Library plan. Draw a room, then come back and Insert it into your scene — inserting copies the layout, so the source stays intact.',
    isDone: () => useSceneStore.getState().objects.some((o) => o.plan != null),
  },
  {
    id: 'figure',
    title: 'Add a Figure',
    body: 'Click the Female figure (or Male) to drop a character into the scene.',
    isDone: () => useSceneStore.getState().objects.some((o) => o.rigKind === 'dummy'),
  },
  {
    id: 'camera',
    title: 'Create a camera option',
    body:
      'Click + to add a camera option. Camera options are alternative moves that share the scene, each edited independently.',
    isDone: () => useCameraOptionsStore.getState().options.length >= 2,
  },
  {
    id: 'path',
    title: 'Draw a camera path',
    body:
      'The Pen is selected. Click in the viewport to place at least two points, then press Enter (or click the first point) to finish the path.',
    isDone: () => activePathAnchorCount() >= 2 && useEditorStore.getState().tool !== 'pen',
  },
  {
    id: 'keyframe',
    title: 'Add a keyframe',
    body:
      'Click + Property to set a keyframe at the playhead. Keyframes turn a property into animation — scrub the timeline to key another moment.',
    isDone: () =>
      hasAnyRigKey() ||
      useSceneStore.getState().objects.some((o) => (o.keys?.length ?? 0) > 0),
  },
  {
    id: 'export',
    title: 'Export a reference',
    body:
      "Click Export to render an MP4 reference of your camera move. That's the tour — export whenever you like.",
    isDone: () => useEditorStore.getState().exportMenuOpen,
  },
]

/** Learner-facing v2 curriculum. IDs are durable project data; do not derive them from array position. */
export interface TutorialActionDefinition {
  id: string
  title: string
  why: string
  instruction: string
  touchInstruction?: string
  /** Visual input cues shown below the written instruction. */
  hints?: readonly TutorialInputHint[]
  /** Touch alternatives for the same card, when the device reports coarse input. */
  touchHints?: readonly TutorialInputHint[]
  /** Specific, observable requirement still needed before Continue unlocks. */
  completionHint?: string
  action: string
  outcome: string
  recovery: string
  target: string | null
  prerequisites: readonly string[]
  completion: 'practice' | 'confirmation'
}

export interface TutorialInputHint {
  label: string
  input: 'mouse-left' | 'mouse-middle' | 'mouse-wheel' | 'keyboard' | 'touch'
  gesture: string
  keys?: readonly string[]
}

export interface TutorialChapterDefinition {
  id: string
  title: string
  actions: readonly TutorialActionDefinition[]
}

const action = (
  id: string,
  title: string,
  why: string,
  instruction: string,
  actionText: string,
  outcome: string,
  recovery: string,
  target: string | null,
  prerequisites: readonly string[] = [],
  completion: 'practice' | 'confirmation' = 'confirmation',
  touchInstruction?: string,
  hints?: readonly TutorialInputHint[],
  touchHints?: readonly TutorialInputHint[],
): TutorialActionDefinition => {
  const visualHints = hints ?? DEFAULT_INPUT_HINTS[id]
  const completionHint = PENDING_REQUIREMENTS[id]
  return {
    id, title, why, instruction,
    ...(touchInstruction ? { touchInstruction } : {}),
    ...(visualHints ? { hints: visualHints } : {}),
    ...(touchHints ? { touchHints } : {}),
    ...(completionHint ? { completionHint } : {}),
    action: actionText, outcome, recovery, target, prerequisites, completion,
  }
}

const DEFAULT_INPUT_HINTS: Readonly<Record<string, readonly TutorialInputHint[]>> = {
  'intro.start': [{ label: 'Start the lesson', input: 'mouse-left', gesture: 'Click' }],
  'room.create': [{ label: 'Create Plan', input: 'mouse-left', gesture: 'Click' }],
  'room.insert': [{ label: 'Insert Plan', input: 'mouse-left', gesture: 'Click' }],
  'room.scene-edit': [
    { label: 'Enter Plan edit mode', input: 'mouse-left', gesture: 'Click' },
    { label: 'Adjust a wall', input: 'mouse-left', gesture: 'Drag slider' },
  ],
  'figure.add': [{ label: 'Choose Figure', input: 'mouse-left', gesture: 'Click' }],
  'figure.pose': [{ label: 'Change a joint', input: 'mouse-left', gesture: 'Drag slider' }],
  'camera.select': [
    { label: 'Select camera', input: 'mouse-left', gesture: 'Click' },
    { label: 'Confirm name', input: 'keyboard', keys: ['Enter'], gesture: 'Shortcut' },
  ],
  'camera.height': [{ label: 'Raise the path', input: 'mouse-left', gesture: 'Drag slider' }],
  'camera.frame': [{ label: 'Look through', input: 'mouse-left', gesture: 'Click' }],
  'timing.duration': [{ label: 'Scrub time', input: 'mouse-left', gesture: 'Drag timeline' }],
  'timing.lens': [{ label: 'Add a key', input: 'mouse-left', gesture: 'Click' }],
  'finish.review': [{ label: 'Review the move', input: 'mouse-left', gesture: 'Click Play' }],
  'finish.export': [{ label: 'Export video', input: 'mouse-left', gesture: 'Click' }],
  'finish.return': [{ label: 'Return to Projects', input: 'mouse-left', gesture: 'Click' }],
}

/**
 * Practice actions unlock only after the app observes their durable outcome.
 * Keep the exact outcome visible so a disabled Continue button is never a
 * mystery to the learner.
 */
const PENDING_REQUIREMENTS: Readonly<Record<string, string>> = {
  'intro.start': 'Start the separate Tutorial project.',
  'navigate.recover': 'Remove only Practice Cube with its trash button in Scene. Continue unlocks when that named cube is gone.',
  'room.create': 'Create the bound Plan from Library.',
  'room.edit': 'Move a starter-room corner, then Save the enclosed Plan.',
  'room.door': 'Place a Door on a wall, then Save the Plan.',
  'room.insert': 'Select the saved Plan and choose Insert into scene.',
  'room.scene-edit': 'Enter Edit Plan in Build, select a wall or opening in the viewport, then change one structural slider.',
  'figure.add': 'Add one Female or Male Figure from Figures.',
  'figure.place': 'Move the bound Figure to a new position in the room.',
  'figure.pose': 'Change one Figure joint while clips are off.',
  'camera.select': 'Rename the starter camera exactly “Room entrance” and press Enter.',
  'camera.path': 'Finish a non-looping two-point path that the camera follows in World space.',
  'camera.height': 'Raise both path endpoints between 1 and 2 metres.',
  'timing.duration': 'Set duration to 6 seconds, then scrub away from the start.',
  'timing.lens': 'Add camera FOV keys near 45° at the start and 40° at the end.',
  'finish.export': 'Export a video file, or press Continue to finish without one.',
  'finish.return': 'Return to Projects, then reopen this Tutorial project.',
}

export const TUTORIAL_CHAPTERS: readonly TutorialChapterDefinition[] = [
  {
    id: 'intro', title: 'See the result and start', actions: [
      action('intro.result', 'Preview the goal', 'A clear destination makes each new tool easier to understand.',
        'You’ll build a room, place a Figure, and make a six-second camera move through the doorway. Study the three example frames, then make your own version.',
        'Look at the example frames in the preview, then continue.', 'You know what the finished lesson is aiming for.',
        'The sample can be skipped; it does not create a project.', null, [], 'confirmation'),
      action('intro.start', 'Start a separate lesson project', 'Projects keep scenes and camera work together.',
        'Home is your starting point. New Project offers a blank scene or AI-assisted planning. This lesson creates a separate Tutorial project with one scene.',
        'Choose Start lesson. Build places objects, Compose makes camera moves, and Visualize reviews the result.',
        'One new Tutorial project is open; existing projects remain as they were.',
        'If starting fails, return to Home and retry. Do not create a Blank project as a substitute.',
        'editor.modes', ['intro.result'], 'practice'),
    ],
  },
  {
    id: 'navigate', title: 'Look around and recover', actions: [
      action('navigate.view', 'Move the working view', 'The working view helps you edit; it is separate from the camera used in the video.',
        'With a mouse, middle-drag to orbit, Shift + middle-drag to pan, and scroll to zoom. On touch, drag with one finger to orbit; drag with two fingers to pan and pinch to zoom. These controls do not animate the shot camera.',
        'Try the gestures around the practice cube. On desktop, open the Help legend for keyboard shortcuts.',
        'You can orbit, pan and zoom the editor view and recognize that the shot camera has not moved.',
        'Use the visible Help controls or confirm after practicing each gesture; if touch is unavailable, continue with an honest support note.',
        'viewport.help', ['intro.start'], 'confirmation',
        'Collapse the lesson instructions (−) to uncover the canvas. Drag with one finger to orbit, two fingers to pan, and pinch to zoom. These gestures move the working view, not the shot camera.',
        [
          { label: 'Orbit', input: 'mouse-middle', gesture: 'Drag' },
          { label: 'Pan', input: 'mouse-middle', keys: ['Shift'], gesture: 'Drag' },
          { label: 'Zoom', input: 'mouse-wheel', gesture: 'Scroll' },
          { label: 'Open Help', input: 'keyboard', keys: ['?'], gesture: 'Shortcuts' },
        ],
        [
          { label: 'Orbit', input: 'touch', gesture: 'One-finger drag' },
          { label: 'Pan', input: 'touch', gesture: 'Two-finger drag' },
          { label: 'Zoom', input: 'touch', gesture: 'Pinch' },
        ]),
      action('navigate.recover', 'Select, frame and undo', 'Selection tells Rig which object a transform should change.',
        'Click the practice cube, press F to frame it, move it a little, then Undo. H returns the view toward the origin.',
        'Practice selection, frame, move and Undo, then remove the named practice cube yourself.',
        'The cube is removed and the room is clear for your Plan.',
        'Undo the deletion if needed. The lesson never removes another object for you.',
        'viewport.outliner', ['navigate.view'], 'practice',
        'Tap the Practice Cube in Scene. Open Tools to use Frame and Home. Collapse the lesson instructions (−) before moving the cube in the viewport; Undo and remove only the named practice cube.',
        [
          { label: 'Select', input: 'mouse-left', gesture: 'Click' },
          { label: 'Frame selection', input: 'keyboard', keys: ['F'], gesture: 'Shortcut' },
          { label: 'View origin', input: 'keyboard', keys: ['H'], gesture: 'Shortcut' },
          { label: 'Undo', input: 'keyboard', keys: ['Ctrl', 'Z'], gesture: 'Shortcut' },
        ]),
    ],
  },
  {
    id: 'room', title: 'Build the room', actions: [
      action('room.create', 'Create a reusable Plan', 'A Plan stores editable walls and openings in Library.',
        'Choose New floor plan to create this room’s Plan. New Plans already contain a four-by-four-metre room.',
        'Open Library and create a new floor plan.', 'The new Plan opens in its editor and is bound to this lesson.',
        'Return to the lesson and retry if Library did not create the Plan.', 'library.new-plan', ['navigate.recover'], 'practice'),
      action('room.edit', 'Resize the starter room', 'Editing the starter rectangle gives the camera room to enter without overlapping walls.',
        'Use Select to drag the existing room corners. About six by five metres is enough. Space + drag pans; scroll zooms; Fit restores the view.',
        'Commit a corner edit while keeping the room enclosed. Room/R can redraw only if the starter room was deleted.',
        'Your Plan still has one enclosed room and the edited walls are saved.',
        'Undo restores the previous corner. Do not draw a second room on top of the starter.',
        'plan.select-tool', ['room.create'], 'practice',
        'Select is already active. Collapse the lesson instructions (−), drag one room corner outward, then tap Fit if the plan moves off-screen. Save the enclosed room.',
        [
          { label: 'Move a corner', input: 'mouse-left', gesture: 'Drag' },
          { label: 'Pan the Plan', input: 'mouse-middle', keys: ['Space'], gesture: 'Drag' },
          { label: 'Zoom', input: 'mouse-wheel', gesture: 'Scroll' },
        ]),
      action('room.door', 'Add an entrance', 'The camera needs an opening so its route does not pass through a solid wall.',
        'Choose Door and click near the middle of one wall to add a doorway.',
        'Place and commit one door opening in the edited room.', 'The door is hosted by a wall and visible in the Plan.',
        'Move the opening along its host wall or undo and place it again.',
        'plan.door-tool', ['room.edit'], 'practice',
        'Tap Door in the Plan toolbar. Collapse the lesson instructions (−), tap near the middle of one wall, then save. The opening snaps to its host wall.',
        [{ label: 'Place door', input: 'mouse-left', gesture: 'Click a wall' }]),
      action('room.insert', 'Save and insert the Plan', 'Inserting copies the Plan graph into the scene; the reusable Library source remains editable.',
        'Return to Library to save, select the bound Plan and choose Insert.',
        'Insert the saved Plan into the Tutorial scene and return to Build.',
        'The scene contains the copy and Library still contains the source Plan.',
        'If the source was edited after insertion, insert it again only after an explicit choice; it does not live-update.',
        'library.insert-plan', ['room.door'], 'practice'),
      action('room.scene-edit', 'Adjust the Scene Plan', 'A Plan in the Scene is a local copy, so you can refine this room without changing the reusable Library source.',
        'In Build, select the inserted room. In Scene Plan, choose Edit Plan, click a wall or opening in the viewport, then change one of its sliders. Save as new Plan is optional when you want to publish a separate reusable copy.',
        'Enter Plan edit mode and change one Room, Wall, Door, or Window value.',
        'The Tutorial Scene has its own updated Plan while the Library source remains unchanged.',
        'Choose Done to return to normal object transforms. Use Edit in Build from Compose or Visualize if you need structural changes later.',
        'build.scene-plan-edit', ['room.insert'], 'practice',
        'Tap the room in Scene, open Director, then tap Edit Plan. Tap a wall, door, window, or floor in the viewport and drag one visible slider. Save as new Plan is optional.',
        [
          { label: 'Enter Plan edit mode', input: 'mouse-left', gesture: 'Click' },
          { label: 'Select structure', input: 'mouse-left', gesture: 'Click viewport' },
          { label: 'Adjust value', input: 'mouse-left', gesture: 'Drag slider' },
        ]),
    ],
  },
  {
    id: 'figure', title: 'Place and pose a Figure', actions: [
      action('figure.add', 'Add a subject', 'The camera move needs a subject to approach.',
        'Open Figures and choose Female or Male.', 'Add one Figure and wait for its pose controls to load.',
        'The new Figure is bound to this lesson.', 'If the Figure tile is unavailable, keep progress and return when the control is available.',
        'build.figures', ['room.scene-edit'], 'practice'),
      action('figure.place', 'Move the Figure into the room', 'Placement gives the camera a clear route and a subject to frame.',
        'Select the Figure and move it inside the room, away from the doorway. W moves; E rotates. Shift-drag changes height.',
        'Position and orient the selected Figure inside the room.', 'The Figure is visibly placed on the Plan floor with room for the camera path.',
        'Undo the transform and try again. The working view controls do not transform the Figure.',
        'build.transform', ['figure.add'], 'practice',
        'With the Figure selected, use Tools: tap W to move or E to rotate. Collapse the lesson instructions (−), then drag the on-screen gizmo. Keep the Figure inside the room and away from the doorway.',
        [
          { label: 'Move', input: 'keyboard', keys: ['W'], gesture: 'Gizmo mode' },
          { label: 'Rotate', input: 'keyboard', keys: ['E'], gesture: 'Gizmo mode' },
          { label: 'Raise or lower', input: 'mouse-left', keys: ['Shift'], gesture: 'Drag' },
        ]),
      action('figure.pose', 'Change one pose', 'A small pose change shows how the subject can communicate an action.',
        'Keep clips off. In the Figure pose inspector, open an arm group and raise one arm with a joint slider. Play clip is a different, animated action.',
        'Change one supported joint; reset and choose a final pose if you want.', 'The bound Figure visibly changes pose without adding animation keys.',
        'Reset the pose and try another slider. Do not use pose keyframes in this lesson.',
        'figure.pose-controls', ['figure.place'], 'practice'),
    ],
  },
  {
    id: 'camera', title: 'Author the camera move', actions: [
      action('camera.select', 'Choose the shot camera', 'A camera option is an editable move; the active option is used for preview and export.',
        'In Compose, select the starter camera row in the Outliner, choose Rename camera, type Room entrance, and press Enter. This lesson uses one camera option.',
        'Select and rename the starter camera option.', 'The active camera is named and ready to follow its path.',
        'Use the Camera list to reselect it. Adding a second option is not required.',
        'compose.camera-row', ['figure.pose'], 'practice',
        'Open Compose and tap Scene. Collapse the lesson card if it covers the camera list, tap the starter camera, then tap Rename camera. Type Room entrance and press Enter.'),
      action('camera.path', 'Draw an open route', 'A path controls where the camera travels.',
        'In Top view choose Pen, place one point outside the doorway and one inside toward the Figure, then press Enter or Finish. Do not close a loop.',
        'Create a nonzero open path and finish it explicitly; verify this camera follows that path.',
        'The camera preview follows the route through the doorway.',
        'Continue the unfinished path or select its points to edit. Leaving Compose does not count as Finish.',
        'compose.pen', ['camera.select'], 'practice',
        'With Tools open, tap Top, then Pen, and close the sheet. Collapse the lesson instructions (−) to uncover the viewport. Tap once outside the doorway and once inside toward the Figure. Tap Finish path; do not tap the first point to close a loop.',
        [
          { label: 'Place point', input: 'mouse-left', gesture: 'Click' },
          { label: 'Finish path', input: 'keyboard', keys: ['Enter'], gesture: 'Shortcut' },
        ]),
      action('camera.height', 'Raise the path', 'Top-view points start near the ground; the camera needs to enter above the floor.',
        'After Pen surface snapping, scroll the Director inspector to Camera Path Height and raise both endpoints to about 1.5 metres.',
        'Give both endpoints a useful shared height below the doorway top.', 'The path enters through the opening without scraping the floor.',
        'If points snap onto a wall, edit both heights after drawing and preview again.',
        'compose.path-height', ['camera.path'], 'practice',
        'In Director, tap Open control if Camera Path Height is off-screen. Collapse the lesson card if it covers the inspector; the shared slider raises both endpoints together to about 1.5 metres.'),
      action('camera.frame', 'Aim and check the view', 'A route only works when the subject stays in frame.',
        'Look through the camera. Track starts aimed at the Figure bounds centre; inspect it, then adjust toward the upper body. Keep the path in World space.',
        'Preview the followed path and adjust its end point, target or field of view until the Figure stays visible.',
        'The camera passes through the doorway and frames the Figure at the beginning and end.',
        'Back the end point away, widen the field of view or adjust the target. Do not add torso height twice.',
        'compose.camera-target', ['camera.height'], 'confirmation',
        'Collapse the lesson card, then tap Look through in the Compose task sheet header. Check the doorway and Figure; tap Return to editor to adjust the camera target in Director. If Camera Target is off-screen, tap Open control; then expand this card and confirm.'),
    ],
  },
  {
    id: 'timing', title: 'Understand time and lens', actions: [
      action('timing.duration', 'Set the move length', 'Path sets the route; duration sets how long the move takes.',
        'Set the camera move to six seconds. Scrub from the start to the end, then play and pause.',
        'Set duration and inspect more than one point on the timeline.', 'The camera travels the route over six seconds.',
        'If the timeline is unavailable, preserve the move and return when Compose controls are available.',
        'compose.timeline', ['camera.frame'], 'practice'),
      action('timing.lens', 'Keyframe a lens change', 'A keyframe stores a property value at a particular time.',
        'At 0 seconds set camera FOV to 45° and add its key. At 6 seconds set 40° and add another. Lower FOV gives a tighter view; it is separate from camera travel.',
        'Add two FOV keys to the bound camera at different times and preview the change.',
        'The same followed path has a subtle lens change during the move.',
        'Use the camera FOV channel, not + Property on the Figure. Undo a misplaced key and keep the camera attached to its path.',
        'compose.fov-key', ['timing.duration'], 'practice',
        'Collapse the lesson card before timeline gestures. In Director, tap Open control if FOV is off-screen. Set 45° and Add key; return to Timeline, scrub to the end, then return to Director, set 40° and Add key.'),
    ],
  },
  {
    id: 'finish', title: 'Review and export', actions: [
      action('finish.review', 'Review the shot', 'Reviewing catches framing problems before export.',
        'In Visualize, watch the move. Check the doorway, the Figure and the framing change.',
        'Confirm the framing or return to Compose to make an adjustment.', 'The current version of the move has been reviewed by you.',
        'Any camera, path, timing or lens edit means review it again.', 'visualize.preview', ['timing.lens'], 'confirmation'),
      action('finish.export', 'Export a reference video', 'Export settings choose what the app renders; opening the menu does not create a video.',
        'Choose Clay, MP4, 16:9 and 720p, then export. PNG is for a single still frame.',
        'Optionally render the video; you may skip export and keep the lesson project.',
        'The browser was offered a non-empty video file, or the summary accurately shows skipped/unsupported.',
        'Cancel or retry after an error. Some browsers may offer WebM instead of MP4; the lesson must report the actual result.',
        'visualize.export', ['finish.review'], 'practice'),
      action('finish.return', 'Save and continue later', 'Saved on this browser and synced to your account are different states.',
        'Check the save status, return to Projects, then reopen this Tutorial project.',
        'Review the practice summary and reopen the same project if you want to continue.',
        'The same project and scene return with honest practiced, confirmed, skipped and export states.',
        'If cloud sync is unavailable, say it is saved locally only. Replaying starts a separate lesson project.',
        'projects.tutorial', ['finish.export'], 'practice'),
    ],
  },
]

export const TUTORIAL_ACTIONS: readonly TutorialActionDefinition[] = TUTORIAL_CHAPTERS.flatMap((chapter) => chapter.actions)
export const TUTORIAL_ACTION_IDS: readonly string[] = TUTORIAL_ACTIONS.map((item) => item.id)
