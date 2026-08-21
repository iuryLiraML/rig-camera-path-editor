import { insertKeyframeAtPlayhead } from '../lib/insertKeyframe'
import { hasKeyAtTime } from '../lib/keyAtPlayhead'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'
import { KeyButton } from './primitives'

export function PoseKeyButton({ objectId }: { objectId: string }) {
  const t = useRigStore((s) => s.t)
  const object = useSceneStore((s) => s.objects.find((item) => item.id === objectId))
  const keyed = object ? hasKeyAtTime(object.keys, t) : false
  const active = (object?.keys.length ?? 0) > 0
  const title = keyed
    ? 'Pose keyframe at the playhead (I to set, Delete to remove)'
    : 'Add a pose keyframe at the playhead (I)'

  return (
    <KeyButton
      active={active}
      onKey={keyed}
      title={title}
      onClick={() => {
        const editor = useEditorStore.getState()
        if (editor.selection !== `obj:${objectId}`) editor.select(`obj:${objectId}`)
        editor.setKeyableFocus('object')
        insertKeyframeAtPlayhead()
      }}
    />
  )
}
