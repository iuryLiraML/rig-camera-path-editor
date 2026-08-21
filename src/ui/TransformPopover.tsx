import { useEffect, useState, type ReactNode } from 'react'
import { hasKeyAtTime } from '../lib/keyAtPlayhead'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore, type Vec3 } from '../state/useSceneStore'
import { LinkIcon } from './icons'
import { PoseKeyButton } from './PoseKeyButton'
import { XYZInput } from './primitives'

export function TransformPopover({ objectId }: { objectId: string }) {
  const object = useSceneStore((s) => s.objects.find((o) => o.id === objectId))
  const t = useRigStore((s) => s.t)
  const [uniform, setUniform] = useState(true)

  useEffect(() => {
    const editor = useEditorStore.getState()
    editor.setKeyableFocus('object')
    return () => {
      if (useEditorStore.getState().keyableFocus === 'object') {
        editor.setKeyableFocus(null)
      }
    }
  }, [objectId])

  if (!object) return null

  const scene = useSceneStore.getState()
  const keyed = hasKeyAtTime(object.keys, t)
  const setAxis = (part: 'position' | 'rotation' | 'scale', axis: 0 | 1 | 2, value: number) => {
    if (part === 'scale' && uniform) {
      const next: Vec3 = [value, value, value]
      scene.setTransformAll(objectId, { ...object.transform, scale: next })
      return
    }
    scene.setTransform(objectId, part, axis, value)
  }

  const markObjectKeyable = (on: boolean) => {
    if (on) useEditorStore.getState().setKeyableFocus('object')
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
      <Row label="Position" keyframe={<PoseKeyButton objectId={objectId} />}>
        <XYZInput
          value={object.transform.position}
          keyed={keyed}
          onFocusChange={markObjectKeyable}
          onChange={(axis, value) => setAxis('position', axis, value)}
        />
      </Row>
      <Row label="Rotation" keyframe={<PoseKeyButton objectId={objectId} />}>
        <XYZInput
          value={object.transform.rotation}
          step={1}
          keyed={keyed}
          onFocusChange={markObjectKeyable}
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
        keyframe={<PoseKeyButton objectId={objectId} />}
      >
        <XYZInput
          value={object.transform.scale}
          keyed={keyed}
          onFocusChange={markObjectKeyable}
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
