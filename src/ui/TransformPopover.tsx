import { useEffect, useState, type ReactNode } from 'react'
import {
  focusForObjectChannel,
  hasObjectChannelKeyAtTime,
  isObjectKeyFocus,
} from '../lib/keyAtPlayhead'
import { evalModelTransform, type ObjectChannel } from '../lib/keyframes'
import { writeObjectTransform } from '../lib/autoKey'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore, type Vec3 } from '../state/useSceneStore'
import { LinkIcon } from './icons'
import { PoseKeyButton } from './PoseKeyButton'
import { XYZInput } from './primitives'
import { patchEnvTransform } from '../lib/environment'
import { useEnvironmentStore } from '../state/useEnvironmentStore'

export function TransformPopover({ objectId }: { objectId: string }) {
  const object = useSceneStore((s) => s.objects.find((o) => o.id === objectId))
  const t = useRigStore((s) => s.t)
  const ease = useRigStore((s) => s.ease)
  const [uniform, setUniform] = useState(true)

  useEffect(() => {
    const editor = useEditorStore.getState()
    editor.setKeyableFocus('object')
    return () => {
      if (isObjectKeyFocus(useEditorStore.getState().keyableFocus)) {
        editor.setKeyableFocus(null)
      }
    }
  }, [objectId])

  if (!object) return null

  const live = evalModelTransform(t, object.keys, ease, object.transform) ?? object.transform
  const setAxis = (part: ObjectChannel, axis: 0 | 1 | 2, value: number) => {
    if (part === 'scale' && uniform) {
      const next: Vec3 = [value, value, value]
      writeObjectTransform(objectId, { ...live, scale: next }, ['scale'])
      return
    }
    const vec = [...live[part]] as Vec3
    vec[axis] = value
    writeObjectTransform(objectId, { ...live, [part]: vec }, [part])
  }

  const markChannel = (channel: ObjectChannel) => (on: boolean) => {
    useEditorStore.getState().setKeyableFocus(on ? focusForObjectChannel(channel) : 'object')
  }

  return (
    <div className="panel w-[280px] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-ink">Transform</span>
        <button
          type="button"
          onClick={() => useEditorStore.getState().setObjectBarPanel('none')}
          className="text-ink-dim hover:text-ink"
        >
          ×
        </button>
      </div>
      <Row label="Position" keyframe={<PoseKeyButton objectId={objectId} channel="position" />}>
        <XYZInput
          value={live.position}
          keyed={hasObjectChannelKeyAtTime(object.keys, 'position', t)}
          onFocusChange={markChannel('position')}
          onChange={(axis, value) => setAxis('position', axis, value)}
        />
      </Row>
      <Row label="Rotation" keyframe={<PoseKeyButton objectId={objectId} channel="rotation" />}>
        <XYZInput
          value={live.rotation}
          step={1}
          keyed={hasObjectChannelKeyAtTime(object.keys, 'rotation', t)}
          onFocusChange={markChannel('rotation')}
          onChange={(axis, value) => setAxis('rotation', axis, value)}
        />
      </Row>
      <Row
        label="Scale"
        extra={
          <button
            type="button"
            title={uniform ? 'Uniform scale on' : 'Uniform scale off'}
            onClick={() => setUniform((v) => !v)}
            className={`rounded p-0.5 ${uniform ? 'text-accent' : 'text-ink-dim hover:text-ink'}`}
          >
            <LinkIcon size={12} />
          </button>
        }
        keyframe={<PoseKeyButton objectId={objectId} channel="scale" />}
      >
        <XYZInput
          value={live.scale}
          keyed={hasObjectChannelKeyAtTime(object.keys, 'scale', t)}
          onFocusChange={markChannel('scale')}
          onChange={(axis, value) => setAxis('scale', axis, value)}
        />
      </Row>
    </div>
  )
}

function Row({
  label,
  extra,
  keyframe,
  children,
}: {
  label: string
  extra?: ReactNode
  keyframe?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-ink-dim">{label}</span>
      {extra}
      <div className="min-w-0 flex-1">{children}</div>
      {keyframe}
    </div>
  )
}

/** Numeric palco pose (E12). No keyframes — the splat is a still Location. */
export function EnvironmentTransformPopover() {
  const transform = useEnvironmentStore((s) => s.environmentTransform)
  const [uniform, setUniform] = useState(true)

  const setAxis = (part: 'position' | 'rotation' | 'scale', axis: 0 | 1 | 2, value: number) => {
    useEnvironmentStore
      .getState()
      .setEnvironmentTransform(patchEnvTransform(transform, part, axis, value, uniform))
  }

  return (
    <div className="panel w-[280px] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-ink">Environment</span>
        <button
          type="button"
          onClick={() => useEditorStore.getState().setObjectBarPanel('none')}
          className="text-ink-dim hover:text-ink"
        >
          ×
        </button>
      </div>
      <Row label="Position">
        <XYZInput value={transform.position} onChange={(axis, value) => setAxis('position', axis, value)} />
      </Row>
      <Row label="Rotation">
        <XYZInput
          value={transform.rotation}
          step={1}
          onChange={(axis, value) => setAxis('rotation', axis, value)}
        />
      </Row>
      <Row
        label="Scale"
        extra={
          <button
            type="button"
            title={uniform ? 'Uniform scale on' : 'Uniform scale off'}
            onClick={() => setUniform((v) => !v)}
            className={`rounded p-0.5 ${uniform ? 'text-accent' : 'text-ink-dim hover:text-ink'}`}
          >
            <LinkIcon size={12} />
          </button>
        }
      >
        <XYZInput value={transform.scale} onChange={(axis, value) => setAxis('scale', axis, value)} />
      </Row>
    </div>
  )
}
