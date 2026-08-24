import { evalProgress, evalValue, keysForObjectChannel, objectKeyChannel, type ValueKey } from './keyframes'
import { evalSeparatedVec3, isVec3AxisChannel, VEC3_AXIS_CHANNELS, type Vec3GroupId } from './vec3Axes'
import { useEditorStore, type SelectedTimelineKey } from '../state/useEditorStore'
import {
  CHANNEL_FIELD,
  useRigStore,
  type RigChannel,
  type ScalarChannel,
} from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'
import { requestPersistFlush } from './persistFlush'
import { type EaseKind } from './easing'
import {
  findKeyAtTime,
  isKeyChannel,
  isObjectKeyFocus,
  objectChannelsForFocus,
} from './keyAtPlayhead'
import type { Vec3 } from '../state/useSceneStore'

export type { SelectedTimelineKey }

function scalarAt(channel: ScalarChannel, rig: ReturnType<typeof useRigStore.getState>) {
  const field = CHANNEL_FIELD[channel]
  const keys = rig[field] as ValueKey[]
  switch (channel) {
    case 'fov':
      return { keys, value: rig.fov }
    case 'roll':
      return { keys, value: rig.roll }
    case 'intensity':
      return { keys, value: rig.cameraNoise.intensity }
    case 'fadeIn':
      return { keys, value: rig.cameraNoise.fadeIn }
    case 'fadeOut':
      return { keys, value: rig.cameraNoise.fadeOut }
    case 'ampPos':
      return { keys, value: rig.cameraNoise.ampPos }
    case 'ampRot':
      return { keys, value: rig.cameraNoise.ampRot }
    case 'freq':
      return { keys, value: rig.cameraNoise.freq }
    case 'staticPosX':
    case 'staticPosY':
    case 'staticPosZ':
      return { keys, value: rig.staticPose.position[axisOf(channel)] }
    case 'staticRotX':
    case 'staticRotY':
    case 'staticRotZ':
      return { keys, value: rig.staticPose.rotation[axisOf(channel)] }
    case 'lookOffsetX':
    case 'lookOffsetY':
    case 'lookOffsetZ':
      return { keys, value: rig.lookOffset[axisOf(channel)] }
    case 'targetX':
    case 'targetY':
    case 'targetZ':
      return { keys, value: rig.target[axisOf(channel)] }
    default: {
      const _never: never = channel
      return _never
    }
  }
}

function axisOf(channel: ScalarChannel): 0 | 1 | 2 {
  if (channel.endsWith('X')) return 0
  if (channel.endsWith('Y')) return 1
  return 2
}

export function evalRigVec3Group(
  group: Vec3GroupId,
  rig = useRigStore.getState(),
  time = rig.t,
): Vec3 {
  const [x, y, z] = VEC3_AXIS_CHANNELS[group]
  const fallback =
    group === 'staticPos'
      ? rig.staticPose.position
      : group === 'staticRot'
        ? rig.staticPose.rotation
        : group === 'lookOffset'
          ? rig.lookOffset
          : rig.target
  return evalSeparatedVec3(
    time,
    rig[CHANNEL_FIELD[x]] as ValueKey[],
    rig[CHANNEL_FIELD[y]] as ValueKey[],
    rig[CHANNEL_FIELD[z]] as ValueKey[],
    fallback,
    rig.ease,
  )
}

export function vec3GroupHasKeys(
  group: Vec3GroupId,
  rig = useRigStore.getState(),
): boolean {
  return VEC3_AXIS_CHANNELS[group].some(
    (channel) => (rig[CHANNEL_FIELD[channel]] as ValueKey[]).length > 0,
  )
}

/** Insert (or merge) a key on one camera channel at an arbitrary time. */
export function insertChannelKeyAt(channel: RigChannel, time: number) {
  const rig = useRigStore.getState()
  const t = Math.min(1, Math.max(0, time))
  if (channel === 'progress') {
    rig.upsertProgressKey(t, evalProgress(t, rig.progressKeys, rig.ease))
  } else {
    const { keys, value } = scalarAt(channel, rig)
    rig.upsertChannelKey(channel, t, evalValue(t, keys, value, rig.ease))
  }
  requestPersistFlush()
}

export function insertVec3GroupAt(group: Vec3GroupId, time?: number) {
  const rig = useRigStore.getState()
  const t = Math.min(1, Math.max(0, time ?? rig.t))
  rig.upsertVec3GroupKey(group, t, evalRigVec3Group(group, rig, t))
  requestPersistFlush()
}

export function deleteSelectedTimelineKey(): boolean {
  const editor = useEditorStore.getState()
  const sel = editor.selectedKeyframe
  if (!sel) return false
  if (sel.kind === 'rig') {
    useRigStore.getState().removeChannelKey(sel.channel, sel.id)
  } else {
    const channels = objectChannelsForFocus(editor.keyableFocus)
    const object = useSceneStore.getState().objects.find((item) => item.id === sel.objectId)
    const key = object?.keys.find((item) => item.id === sel.id)
    const channel = channels.length === 1 ? channels[0] : undefined
    if (
      key &&
      channel &&
      (objectKeyChannel(key) === 'pose' || objectKeyChannel(key) === channel)
    ) {
      useSceneStore.getState().removeObjectKeysAtTime(sel.objectId, key.time, [channel])
    } else {
      useSceneStore.getState().removeObjectKey(sel.objectId, sel.id)
    }
  }
  editor.selectKeyframe(null)
  return true
}

function poseKeyable(editor: ReturnType<typeof useEditorStore.getState>): boolean {
  if (isObjectKeyFocus(editor.keyableFocus)) return true
  if (!editor.selection?.startsWith('obj:')) return false
  return editor.objectBarPanel === 'transform' || editor.objectBarPanel === 'properties'
}

function deleteObjectChannelsAtPlayhead(): boolean {
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()
  const id = editor.selection?.startsWith('obj:') ? editor.selection.slice(4) : null
  if (!id) return false
  const object = useSceneStore.getState().objects.find((item) => item.id === id)
  if (!object) return false
  const channels = objectChannelsForFocus(editor.keyableFocus)
  const hadKey = channels.some((channel) =>
    Boolean(findKeyAtTime(keysForObjectChannel(object.keys, channel), rig.t)),
  )
  if (!hadKey) return false
  useSceneStore.getState().removeObjectKeysAtTime(id, rig.t, channels)
  editor.selectKeyframe(null)
  return true
}

/** Remove the key on the playhead for the focused property / open Transform panel. */
export function deleteKeyframeAtPlayhead(): boolean {
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()
  const focus = editor.keyableFocus

  if (isObjectKeyFocus(focus) || poseKeyable(editor)) {
    if (deleteObjectChannelsAtPlayhead()) return true
    if (isObjectKeyFocus(focus)) return false
  }

  if (isKeyChannel(focus)) {
    const field = CHANNEL_FIELD[focus]
    const keys = rig[field] as { id: string; time: number }[]
    const key = findKeyAtTime(keys, rig.t)
    if (!key) return false
    rig.removeChannelKey(focus, key.id)
    editor.selectKeyframe(null)
    return true
  }

  return false
}

export function selectRigKeyAtTime(channel: RigChannel, time: number) {
  const field = CHANNEL_FIELD[channel]
  const keys = useRigStore.getState()[field] as { id: string; time: number }[]
  const key = findKeyAtTime(keys, time)
  if (!key) return
  useEditorStore.getState().selectTimelineKey({ kind: 'rig', channel, id: key.id }, 'cinema-camera')
}

export function selectedKeyEase(): EaseKind | null {
  const sel = useEditorStore.getState().selectedKeyframe
  if (!sel) return null
  if (sel.kind === 'object') {
    const object = useSceneStore.getState().objects.find((item) => item.id === sel.objectId)
    const key = object?.keys.find((item) => item.id === sel.id)
    return key?.ease ?? useRigStore.getState().ease
  }
  const rig = useRigStore.getState()
  const field = CHANNEL_FIELD[sel.channel]
  const keys = rig[field] as { id: string; ease?: EaseKind }[]
  const key = keys.find((item) => item.id === sel.id)
  return key?.ease ?? rig.ease
}

export function setSelectedKeyEase(ease: EaseKind) {
  const sel = useEditorStore.getState().selectedKeyframe
  if (!sel) return
  if (sel.kind === 'object') {
    useSceneStore.getState().setObjectKeyEase(sel.objectId, sel.id, ease)
    return
  }
  useRigStore.getState().setKeyEase(sel.channel, sel.id, ease)
}

export { isVec3AxisChannel }
