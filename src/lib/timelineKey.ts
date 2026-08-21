import {
  evalProgress,
  evalValue,
  evalVec3,
  keysForObjectChannel,
  objectKeyChannel,
} from './keyframes'
import { useEditorStore, type SelectedTimelineKey } from '../state/useEditorStore'
import { useRigStore, type RigChannel, type ScalarChannel } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'
import { requestPersistFlush } from './persistFlush'
import { type EaseKind } from './easing'
import {
  findKeyAtTime,
  isKeyChannel,
  isObjectKeyFocus,
  objectChannelsForFocus,
} from './keyAtPlayhead'

export type { SelectedTimelineKey }

/** Insert (or merge) a key on one camera channel at an arbitrary time. */
export function insertChannelKeyAt(channel: RigChannel, time: number) {
  const rig = useRigStore.getState()
  const t = Math.min(1, Math.max(0, time))
  switch (channel) {
    case 'progress':
      rig.upsertProgressKey(t, evalProgress(t, rig.progressKeys, rig.ease))
      break
    case 'target':
      rig.upsertTargetKey(t, evalVec3(t, rig.targetKeys, rig.target, rig.ease))
      break
    case 'lookOffset':
      rig.upsertLookOffsetKey(t, evalVec3(t, rig.lookOffsetKeys, rig.lookOffset, rig.ease))
      break
    case 'staticPos':
      rig.upsertStaticPosKey(t, evalVec3(t, rig.staticPosKeys, rig.staticPose.position, rig.ease))
      break
    case 'staticRot':
      rig.upsertStaticRotKey(t, evalVec3(t, rig.staticRotKeys, rig.staticPose.rotation, rig.ease))
      break
    case 'fov':
    case 'roll':
    case 'intensity':
    case 'fadeIn':
    case 'fadeOut':
    case 'ampPos':
    case 'ampRot':
    case 'freq': {
      const { keys, value } = scalarAt(channel, rig)
      rig.upsertChannelKey(channel, t, evalValue(t, keys, value, rig.ease))
      break
    }
    default: {
      const _never: never = channel
      return _never
    }
  }
  requestPersistFlush()
}

function scalarAt(channel: ScalarChannel, rig: ReturnType<typeof useRigStore.getState>) {
  switch (channel) {
    case 'fov':
      return { keys: rig.fovKeys, value: rig.fov }
    case 'roll':
      return { keys: rig.rollKeys, value: rig.roll }
    case 'intensity':
      return { keys: rig.intensityKeys, value: rig.cameraNoise.intensity }
    case 'fadeIn':
      return { keys: rig.fadeInKeys, value: rig.cameraNoise.fadeIn }
    case 'fadeOut':
      return { keys: rig.fadeOutKeys, value: rig.cameraNoise.fadeOut }
    case 'ampPos':
      return { keys: rig.ampPosKeys, value: rig.cameraNoise.ampPos }
    case 'ampRot':
      return { keys: rig.ampRotKeys, value: rig.cameraNoise.ampRot }
    case 'freq':
      return { keys: rig.freqKeys, value: rig.cameraNoise.freq }
    default: {
      const _never: never = channel
      return _never
    }
  }
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
    const field = channelField(focus)
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
  const field = channelField(channel)
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
  const field = channelField(sel.channel)
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

function channelField(channel: RigChannel) {
  switch (channel) {
    case 'fov':
      return 'fovKeys' as const
    case 'roll':
      return 'rollKeys' as const
    case 'intensity':
      return 'intensityKeys' as const
    case 'fadeIn':
      return 'fadeInKeys' as const
    case 'fadeOut':
      return 'fadeOutKeys' as const
    case 'ampPos':
      return 'ampPosKeys' as const
    case 'ampRot':
      return 'ampRotKeys' as const
    case 'freq':
      return 'freqKeys' as const
    case 'target':
      return 'targetKeys' as const
    case 'lookOffset':
      return 'lookOffsetKeys' as const
    case 'staticPos':
      return 'staticPosKeys' as const
    case 'staticRot':
      return 'staticRotKeys' as const
    case 'progress':
      return 'progressKeys' as const
    default: {
      const _never: never = channel
      return _never
    }
  }
}
