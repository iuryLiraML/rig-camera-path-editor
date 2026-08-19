import { useState, type ReactNode } from 'react'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore, type Vec3 } from '../state/useSceneStore'
import { LinkIcon } from './icons'
import { XYZInput } from './primitives'

export function TransformPopover({ objectId }: { objectId: string }) {
  const object = useSceneStore((s) => s.objects.find((o) => o.id === objectId))
  const [uniform, setUniform] = useState(true)
  if (!object) return null

  const scene = useSceneStore.getState()
  const setAxis = (part: 'position' | 'rotation' | 'scale', axis: 0 | 1 | 2, value: number) => {
    if (part === 'scale' && uniform) {
      const next: Vec3 = [value, value, value]
      scene.setTransformAll(objectId, { ...object.transform, scale: next })
      return
    }
    scene.setTransform(objectId, part, axis, value)
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
      <Row label="Position">
        <XYZInput
          value={object.transform.position}
          onChange={(axis, value) => setAxis('position', axis, value)}
        />
      </Row>
      <Row label="Rotation">
        <XYZInput
          value={object.transform.rotation}
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
        <XYZInput
          value={object.transform.scale}
          onChange={(axis, value) => setAxis('scale', axis, value)}
        />
      </Row>
    </div>
  )
}

function Row({
  label,
  extra,
  children,
}: {
  label: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-ink-dim">{label}</span>
      {extra}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
