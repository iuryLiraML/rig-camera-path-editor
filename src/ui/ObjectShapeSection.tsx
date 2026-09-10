import { useSceneStore } from '../state/useSceneStore'
import { ClayColorControl } from './RightPanel'
import { PrimitiveShapeControls } from './SolidControls'

/** Name, clay look, and (for primitives) CAD ops. Lives under Transform on the Director rail. */
export function ObjectShapeSection({ objectId }: { objectId: string }) {
  const object = useSceneStore((s) => s.objects.find((item) => item.id === objectId))
  if (!object) return null
  const shade = object.shade ?? 0.7
  return (
    <div className="mt-3 border-t border-line/60 p-2" data-shape-section>
      <span className="text-[12px] font-semibold text-ink">Shape</span>
      <input
        value={object.name}
        aria-label="Object name"
        onChange={(e) => useSceneStore.getState().renameObject(objectId, e.target.value)}
        className="mt-2 w-full rounded-md bg-panel-2 px-2 py-1.5 text-[12px] text-ink outline-none"
      />
      {object.primitive && (
        <div className="mt-3">
          <PrimitiveShapeControls object={object} />
        </div>
      )}
      <label className="mt-3 block text-[10px] uppercase tracking-wide text-ink-dim">Shade</label>
      <input
        type="range"
        min={0.15}
        max={0.95}
        step={0.01}
        value={shade}
        aria-label="Shade"
        onChange={(e) => useSceneStore.getState().setObjectShade(objectId, Number(e.target.value))}
        className="mt-1 w-full"
      />
      <label className="mt-3 block text-[10px] uppercase tracking-wide text-ink-dim">Clay color</label>
      <div className="mt-1">
        <ClayColorControl objectId={objectId} />
      </div>
    </div>
  )
}
