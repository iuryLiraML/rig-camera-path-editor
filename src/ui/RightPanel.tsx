import { useState } from 'react'

import { useEditorStore, type ExportAspect, type ExportRes } from '../state/useEditorStore'
import { AssistantPanel } from './AssistantPanel'
import { defaultFollow, useSceneStore, type Vec3 } from '../state/useSceneStore'
import { getRigSnapshot, openRigImportDialog, useRigStore, type RigChannel } from '../state/useRigStore'
import { useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { evalProgress, evalValue, evalVec3 } from '../lib/keyframes'
import { easeGroups, easeDef, type EaseKind } from '../lib/easing'
import { exportDimensions } from '../lib/recorder'
import { applyCameraPreset, PRESETS } from '../lib/presets'
import { PRIMITIVE_DEFS } from '../lib/primitiveGeometry'
import {
  ColorField,
  meters,
  NumberInput,
  pct,
  Row,
  Section,
  Segmented,
  secs,
  Slider,
  XYZInput,
} from './primitives'

function PanelButton({
  label,
  onClick,
  tone = 'normal',
  title,
}: {
  label: string
  onClick: () => void
  tone?: 'normal' | 'danger' | 'accent'
  title?: string
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex-1 rounded-md px-2 py-1.5 text-[11px] ${
        tone === 'accent'
          ? 'bg-accent text-white hover:bg-accent/85'
          : tone === 'danger'
            ? 'bg-panel-2 text-red-400 hover:bg-panel-3'
            : 'bg-panel-2 text-ink hover:bg-panel-3'
      }`}
    >
      {label}
    </button>
  )
}

function KeyList({
  items,
  onRemove,
}: {
  items: { id: string; label: string }[]
  onRemove: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((k) => (
        <div
          key={k.id}
          className="flex items-center justify-between rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink"
        >
          <span className="tabular-nums">{k.label}</span>
          <button
            onClick={() => onRemove(k.id)}
            className="text-ink-dim hover:text-red-400"
            title="Delete keyframe"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

const deg = (v: number) => `${Math.round(v)}°`

/**
 * The animation-curve picker, in the vocabulary of After Effects and Premiere:
 * Penner families grouped by direction, with the shortlist that matters for a
 * camera move on top. See lib/easing.ts for the bezier values and why.
 */
function EaseSelect({
  value,
  onChange,
  title,
}: {
  value: EaseKind
  onChange: (ease: EaseKind) => void
  title?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as EaseKind)}
      title={title ?? easeDef(value).hint}
      className="w-full rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink outline-none focus:ring-1 focus:ring-accent"
    >
      {easeGroups().map((group) => (
        <optgroup key={group.group} label={group.group}>
          {group.items.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/** the ◆ that pins the current value of a channel at the playhead */
function KeyButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Add a keyframe for this property at the playhead"
      className={`shrink-0 text-[11px] leading-none transition-colors ${
        active ? 'text-accent' : 'text-ink-dim hover:text-ink'
      }`}
    >
      ◆
    </button>
  )
}

/**
 * Keyframes of one channel, each with the curve used to leave it. A channel with
 * no keys keeps its static value, so the first ◆ is what turns it into animation.
 */
function ChannelKeys({
  channel,
  keys,
  duration,
  format,
}: {
  channel: RigChannel
  keys: { id: string; time: number; ease?: EaseKind }[]
  duration: number
  format: (key: { id: string; time: number }) => string
}) {
  const rig = useRigStore.getState()
  if (keys.length === 0) return null
  const sorted = [...keys].sort((a, b) => a.time - b.time)
  return (
    <div className="flex flex-col gap-1 pl-1">
      {sorted.map((key, i) => (
        <div key={key.id} className="rounded-md bg-panel-2/60 px-1.5 py-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] tabular-nums text-ink-dim">
              {(key.time * duration).toFixed(1)}s
            </span>
            <span className="text-[10px] tabular-nums text-ink">{format(key)}</span>
            <button
              onClick={() => rig.removeChannelKey(channel, key.id)}
              title="Delete keyframe"
              className="ml-auto text-[11px] leading-none text-ink-dim hover:text-red-400"
            >
              ×
            </button>
          </div>
          {/* the curve belongs to the segment leaving this key, so the last one
              has nothing to ease into */}
          {i < sorted.length - 1 && (
            <div className="mt-1">
              <EaseSelect
                value={key.ease ?? useRigStore.getState().ease}
                onChange={(ease) => rig.setKeyEase(channel, key.id, ease)}
                title="Curve used to leave this keyframe"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function FollowSection({ objectId }: { objectId: string }) {
  const object = useSceneStore((s) => s.objects.find((o) => o.id === objectId))
  const paths = usePathStore((s) => s.paths)
  const scene = useSceneStore.getState()
  const follow = object?.follow
  if (!object) return null

  const onSelect = (value: string) => {
    if (value === '') {
      scene.setFollow(object.id, null)
    } else if (value === '__new') {
      // create a fresh path, make it active and draw it with the pen tool
      const id = usePathStore.getState().createPath()
      useEditorStore.getState().setTool('pen')
      scene.setFollow(object.id, defaultFollow(id))
      scene.showNotice('New path — draw the route with the pen tool')
    } else {
      scene.setFollow(object.id, follow ? { ...follow, pathId: value } : defaultFollow(value))
    }
  }

  const set = (patch: Partial<NonNullable<typeof follow>>) => {
    if (follow) scene.setFollow(object.id, { ...follow, ...patch })
  }

  return (
    <Section title="Follow path">
      <Row label="Path">
        <select
          value={follow?.pathId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full min-w-0 rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink outline-none"
        >
          <option value="">None</option>
          {paths.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === CAMERA_PATH_ID ? 'Camera Path' : p.name}
            </option>
          ))}
          <option value="__new">+ New path…</option>
        </select>
      </Row>
      {follow && (
        <>
          <Row label="Align">
            <Segmented
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              value={follow.align ? 'yes' : 'no'}
              onChange={(v) => set({ align: v === 'yes' })}
            />
          </Row>
          <Row label="Start">
            <Slider value={follow.offset} onChange={(v) => set({ offset: v })} format={pct} />
          </Row>
          <Row label="Height">
            <Slider
              value={follow.height}
              onChange={(v) => set({ height: v })}
              min={-3}
              max={8}
              step={0.1}
              format={meters}
            />
          </Row>
          {follow.align && (
            <Row label="Bank">
              <Slider
                value={follow.bank}
                onChange={(v) => set({ bank: v })}
                min={-90}
                max={90}
                step={1}
                format={deg}
              />
            </Row>
          )}
          <Row label="Loops">
            <Slider value={follow.loops} onChange={(v) => set({ loops: v })} min={1} max={8} step={1} format={(v) => String(Math.round(v))} />
          </Row>
        </>
      )}
    </Section>
  )
}

function ObjectSections({ objectId }: { objectId: string }) {
  const object = useSceneStore((s) => s.objects.find((o) => o.id === objectId))
  const t = useRigStore((s) => s.t)
  const duration = useRigStore((s) => s.duration)
  const scene = useSceneStore.getState()

  if (!object) return null
  const sortedKeys = [...object.keys].sort((a, b) => a.time - b.time)
  const following = !!object.follow

  return (
    <>
      {!following && (
        <Section title="Animation">
          <div className="flex gap-1.5">
            <PanelButton
              label={`Keyframe at ${(t * duration).toFixed(1)}s`}
              tone="accent"
              title="Save the current pose at the current time"
              onClick={() => {
                scene.addObjectKey(object.id, useRigStore.getState().t)
                scene.showNotice('Pose keyframe added — move the playhead and pose again')
              }}
            />
            <PanelButton
              label="Spin 360°"
              title="Full turn over the whole animation"
              onClick={() => {
                scene.applySpinPreset(object.id)
                scene.showNotice('Spin applied — press play')
              }}
            />
          </div>
          <KeyList
            items={sortedKeys.map((k) => ({
              id: k.id,
              label: `${(k.time * duration).toFixed(1)}s — pose`,
            }))}
            onRemove={(keyId) => scene.removeObjectKey(object.id, keyId)}
          />
          {object.keys.length > 0 && (
            <PanelButton
              label="Clear animation"
              tone="danger"
              onClick={() => scene.clearObjectKeys(object.id)}
            />
          )}
          {object.clips.length > 0 && (
            <Row label="File clips">
              <Segmented
                options={[
                  { value: 'on', label: 'Play' },
                  { value: 'off', label: 'Off' },
                ]}
                value={object.playClips ? 'on' : 'off'}
                onChange={(v) => scene.setPlayClips(object.id, v === 'on')}
              />
            </Row>
          )}
        </Section>
      )}
      <FollowSection objectId={object.id} />
      {object.primitive && (
        <Section title="Shape">
          {PRIMITIVE_DEFS[object.primitive.kind].params.map((def) => {
            const value = object.primitive!.params[def.key] ?? def.default
            return (
              <Row key={def.key} label={def.label}>
                <Slider
                  value={value}
                  onChange={(v) => scene.updatePrimitiveParams(object.id, { [def.key]: v })}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  format={def.step >= 1 ? (n) => String(Math.round(n)) : meters}
                />
              </Row>
            )
          })}
        </Section>
      )}
      <Section title="Transform">
        {!following && (
          <Row label="Position">
            <XYZInput
              value={object.transform.position}
              onChange={(a, v) => scene.setTransform(object.id, 'position', a, v)}
            />
          </Row>
        )}
        {!(following && object.follow?.align) && (
          <Row label="Rotation">
            <XYZInput
              value={object.transform.rotation}
              step={1}
              onChange={(a, v) => scene.setTransform(object.id, 'rotation', a, v)}
            />
          </Row>
        )}
        <Row label="Scale">
          <XYZInput
            value={object.transform.scale}
            onChange={(a, v) => scene.setTransform(object.id, 'scale', a, v)}
          />
        </Row>
      </Section>
      <Section title="Material · Clay">
        <Row label="Shade">
          <Slider
            value={object.shade}
            onChange={(v) => scene.setObjectShade(object.id, v)}
            min={0.15}
            max={0.95}
            step={0.01}
            format={pct}
          />
        </Row>
      </Section>
      <Section title="Object">
        <Row label="Name">
          <input
            value={object.name}
            onChange={(e) => scene.renameObject(object.id, e.target.value)}
            className="w-full min-w-0 rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink outline-none"
          />
        </Row>
        <div className="flex gap-1.5">
          <PanelButton
            label="Duplicate"
            title="Copy this object, its pose and its keyframes"
            onClick={() => scene.duplicateObject(object.id)}
          />
          <PanelButton
            label="Delete"
            tone="danger"
            onClick={() => {
              scene.removeObject(object.id)
              useEditorStore.getState().select(null)
            }}
          />
        </div>
      </Section>
    </>
  )
}

function LightSections() {
  const lightIntensity = useSceneStore((s) => s.lightIntensity)
  const setLightIntensity = useSceneStore((s) => s.setLightIntensity)
  return (
    <Section title="Light">
      <Row label="Intensity">
        <Slider value={lightIntensity} onChange={setLightIntensity} min={0} max={3} />
      </Row>
    </Section>
  )
}

function PathSections() {
  const active = usePathStore((s) => s.paths.find((p) => p.id === s.activePathId))
  const activePathId = usePathStore((s) => s.activePathId)
  const anchors = active?.anchors ?? []
  const closed = active?.closed ?? false
  const rounding = active?.rounding ?? 0.8
  const selectedAnchorId = usePathStore((s) => s.selectedAnchorId)
  const drawPlaneY = usePathStore((s) => s.drawPlaneY)
  const path = usePathStore.getState()
  const showNotice = useSceneStore((s) => s.showNotice)

  const isCamera = activePathId === CAMERA_PATH_ID
  const selected = anchors.find((a) => a.id === selectedAnchorId)
  const index = selected ? anchors.indexOf(selected) : -1
  const pathHeight = anchors[0]?.position[1] ?? drawPlaneY
  const hasManual = anchors.some((a) => a.manual)

  return (
    <>
      <Section title={isCamera ? 'Camera Path' : 'Path'}>
        {!isCamera && (
          <Row label="Name">
            <input
              value={active?.name ?? ''}
              onChange={(e) => path.renamePath(activePathId, e.target.value)}
              className="w-full min-w-0 rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink outline-none"
            />
          </Row>
        )}
        {isCamera && (
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <PanelButton
                key={p.kind}
                label={p.label}
                title={p.hint}
                onClick={() => {
                  applyCameraPreset(p.kind)
                  showNotice(`"${p.label}" preset applied`)
                }}
              />
            ))}
          </div>
        )}
        {anchors.length === 0 && (
          <PanelButton
            label="Draw points"
            tone="accent"
            title="Activate the pen tool to draw this path"
            onClick={() => useEditorStore.getState().setTool('pen')}
          />
        )}
        <Row label="Curves">
          <Slider value={rounding} onChange={path.setRounding} format={pct} />
        </Row>
        <Row label="Height">
          <Slider value={pathHeight} onChange={path.setPathHeight} min={0.2} max={10} step={0.1} format={meters} />
        </Row>
        <Row label="Closed">
          <Segmented
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            value={closed ? 'yes' : 'no'}
            onChange={(v) => path.setClosed(v === 'yes')}
          />
        </Row>
        {hasManual && (
          <PanelButton
            label="Auto-smooth everything"
            title="Discard manual handle edits and recompute curves from the slider"
            onClick={() => path.autoSmoothAll()}
          />
        )}
        <div className="flex gap-1.5">
          {isCamera && (
            <PanelButton
              label="Import JSON"
              onClick={() => openRigImportDialog((ok) => showNotice(ok ? 'Rig imported' : 'Invalid JSON file'))}
            />
          )}
          <PanelButton
            label="Clear"
            tone="danger"
            onClick={() => {
              path.clearPath()
              useEditorStore.getState().select(null)
            }}
          />
        </div>
        {!isCamera && (
          <PanelButton
            label="Delete path"
            tone="danger"
            title="Remove this path (attached objects fall back to their pose)"
            onClick={() => {
              const id = activePathId
              path.removePath(id)
              // detach any object that was riding this path
              useSceneStore.getState().objects.forEach((o) => {
                if (o.follow?.pathId === id) useSceneStore.getState().setFollow(o.id, null)
              })
              useEditorStore.getState().select(null)
            }}
          />
        )}
      </Section>

      {selected && (
        <Section title={`Point ${index + 1}`}>
          <Row label="Height">
            <Slider
              value={selected.position[1]}
              onChange={(y) => path.setAnchorHeight(selected.id, y)}
              min={0.2}
              max={10}
              step={0.1}
              format={meters}
            />
          </Row>
          <Row label="Position">
            <XYZInput
              value={selected.position}
              onChange={(axis, v) => {
                const next = [...selected.position] as Vec3
                next[axis] = v
                path.updateAnchorPosition(selected.id, next)
              }}
            />
          </Row>
          {selected.manual && (
            <>
              <Row label="Handles">
                <Segmented
                  options={[
                    { value: 'mirrored', label: 'Mirrored' },
                    { value: 'broken', label: 'Broken' },
                  ]}
                  value={selected.mirrored ? 'mirrored' : 'broken'}
                  onChange={(v) => path.setHandle(selected.id, 'out', selected.handleOut, v === 'broken')}
                />
              </Row>
              <Row label="Handle In">
                <XYZInput
                  value={selected.handleIn}
                  onChange={(axis, v) => {
                    const next = [...selected.handleIn] as Vec3
                    next[axis] = v
                    path.setHandle(selected.id, 'in', next, false)
                  }}
                />
              </Row>
              <Row label="Handle Out">
                <XYZInput
                  value={selected.handleOut}
                  onChange={(axis, v) => {
                    const next = [...selected.handleOut] as Vec3
                    next[axis] = v
                    path.setHandle(selected.id, 'out', next, false)
                  }}
                />
              </Row>
            </>
          )}
          <PanelButton label="Delete Point" tone="danger" onClick={() => path.removeAnchor(selected.id)} />
        </Section>
      )}
    </>
  )
}

function CinemaCameraSections() {
  const duration = useRigStore((s) => s.duration)
  const ease = useRigStore((s) => s.ease)
  const loop = useRigStore((s) => s.loop)
  const lookAtMode = useRigStore((s) => s.lookAtMode)
  const target = useRigStore((s) => s.target)
  const roll = useRigStore((s) => s.roll)
  const fov = useRigStore((s) => s.fov)
  const t = useRigStore((s) => s.t)
  const progressKeys = useRigStore((s) => s.progressKeys)
  const fovKeys = useRigStore((s) => s.fovKeys)
  const rollKeys = useRigStore((s) => s.rollKeys)
  const targetKeys = useRigStore((s) => s.targetKeys)
  const rig = useRigStore.getState()

  // a channel with keyframes shows its animated value at the playhead, so the
  // slider always reflects what the camera is doing right now
  const fovNow = evalValue(t, fovKeys, fov, ease)
  const rollNow = evalValue(t, rollKeys, roll, ease)
  const targetNow = evalVec3(t, targetKeys, target, ease)

  const currentProgress = evalProgress(t, progressKeys, ease)
  const sortedKeys = [...progressKeys].sort((a, b) => a.time - b.time)

  return (
    <>
      <Section title="Animation">
        <Row label="Duration">
          <Slider value={duration} onChange={rig.setDuration} min={1} max={30} step={0.5} format={secs} />
        </Row>
        <Row label="Curve">
          <EaseSelect value={ease} onChange={rig.setEase} />
        </Row>
        <Row label="Loop">
          <Segmented
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            value={loop ? 'yes' : 'no'}
            onChange={(v) => rig.setLoop(v === 'yes')}
          />
        </Row>
      </Section>
      <Section title="Keyframes">
        <PanelButton
          label="Path, presets & shape"
          onClick={() => useEditorStore.getState().select(CAMERA_PATH_ID)}
        />
        <div className="text-[10px] leading-relaxed text-ink-dim">
          Move the playhead, then drag the slider to pin where on the path the camera
          should be at that moment.
        </div>
        <Row label="On path">
          <Slider
            value={currentProgress}
            onChange={(p) => {
              const state = useRigStore.getState()
              state.setPlaying(false)
              state.upsertProgressKey(state.t, p)
            }}
            format={pct}
          />
        </Row>
        <ChannelKeys
          channel="progress"
          keys={sortedKeys}
          duration={duration}
          format={(k) =>
            `${Math.round((sortedKeys.find((s) => s.id === k.id)?.progress ?? 0) * 100)}%`
          }
        />
        {progressKeys.length > 0 && (
          <PanelButton label="Clear keyframes" tone="danger" onClick={rig.clearProgressKeys} />
        )}
      </Section>
      <Section title="Lens">
        <Row label="FOV">
          <div className="flex items-center gap-2">
            <Slider
              value={fovNow}
              onChange={(v) => {
                const state = useRigStore.getState()
                // editing an animated channel writes the keyframe at the
                // playhead; editing a static one moves the static value
                if (state.fovKeys.length > 0) state.upsertChannelKey('fov', state.t, v)
                else state.setFov(v)
              }}
              min={15}
              max={120}
              step={1}
              format={deg}
            />
            <KeyButton
              active={fovKeys.length > 0}
              onClick={() => {
                const state = useRigStore.getState()
                state.setPlaying(false)
                state.upsertChannelKey('fov', state.t, fovNow)
              }}
            />
          </div>
        </Row>
        <ChannelKeys
          channel="fov"
          keys={fovKeys}
          duration={duration}
          format={(k) => deg(fovKeys.find((x) => x.id === k.id)?.value ?? 0)}
        />
        <Row label="Roll">
          <div className="flex items-center gap-2">
            <Slider
              value={rollNow}
              onChange={(v) => {
                const state = useRigStore.getState()
                if (state.rollKeys.length > 0) state.upsertChannelKey('roll', state.t, v)
                else state.setRoll(v)
              }}
              min={-180}
              max={180}
              step={1}
              format={deg}
            />
            <KeyButton
              active={rollKeys.length > 0}
              onClick={() => {
                const state = useRigStore.getState()
                state.setPlaying(false)
                state.upsertChannelKey('roll', state.t, rollNow)
              }}
            />
          </div>
        </Row>
        <ChannelKeys
          channel="roll"
          keys={rollKeys}
          duration={duration}
          format={(k) => deg(rollKeys.find((x) => x.id === k.id)?.value ?? 0)}
        />
      </Section>
      <CameraFormatSection />
      <CameraOptionSection />
      <Section title="Look At">
        <Row label="Mode">
          <Segmented
            options={[
              { value: 'target', label: 'Target' },
              { value: 'path-tangent', label: 'Motion' },
            ]}
            value={lookAtMode}
            onChange={(v) => rig.setLookAtMode(v)}
          />
        </Row>
        {lookAtMode === 'target' && (
          <>
            <Row label="Target">
              <div className="flex items-center gap-2">
                <XYZInput
                  value={targetNow}
                  onChange={(axis, v) => {
                    const state = useRigStore.getState()
                    const next = [...targetNow] as Vec3
                    next[axis] = v
                    if (state.targetKeys.length > 0) state.upsertTargetKey(state.t, next)
                    else state.setTarget(next)
                  }}
                />
                <KeyButton
                  active={targetKeys.length > 0}
                  onClick={() => {
                    const state = useRigStore.getState()
                    state.setPlaying(false)
                    state.upsertTargetKey(state.t, targetNow)
                  }}
                />
              </div>
            </Row>
            <ChannelKeys
              channel="target"
              keys={targetKeys}
              duration={duration}
              format={(k) => {
                const v = targetKeys.find((x) => x.id === k.id)?.value
                return v ? v.map((n) => n.toFixed(1)).join(', ') : ''
              }}
            />
          </>
        )}
      </Section>
    </>
  )
}

/**
 * Identity of the selected camera. The only way to delete one used to be a
 * hover-only "x" in the outliner, so from here — where you actually edit a
 * camera — it looked like cameras could not be removed at all.
 */
function CameraOptionSection() {
  const options = useCameraOptionsStore((s) => s.options)
  const activeId = useCameraOptionsStore((s) => s.activeOptionId)
  const active = options.find((option) => option.id === activeId)
  const [confirming, setConfirming] = useState(false)
  if (!active) return null

  return (
    <Section title="Camera">
      <Row label="Name">
        <input
          value={active.name}
          onChange={(e) => useCameraOptionsStore.getState().renameOption(active.id, e.target.value)}
          className="w-full rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink outline-none focus:ring-1 focus:ring-accent"
        />
      </Row>
      <div className="flex gap-1.5">
        <PanelButton
          label="Duplicate"
          onClick={() => {
            const id = useCameraOptionsStore.getState().createOption(`${active.name} copy`, getRigSnapshot())
            useCameraOptionsStore.getState().switchOption(id)
          }}
        />
        {options.length > 1 ? (
          <PanelButton
            label={confirming ? 'Delete for good?' : 'Delete'}
            tone="danger"
            onClick={() => {
              if (!confirming) {
                setConfirming(true)
                return
              }
              useCameraOptionsStore.getState().removeOption(active.id)
              setConfirming(false)
            }}
          />
        ) : (
          <span className="self-center text-[10px] text-ink-dim">
            The last camera cannot be deleted
          </span>
        )}
      </div>
    </Section>
  )
}

/** Output format of the cinema camera — drives the PiP guides and video export. */
function CameraFormatSection() {
  const exportAspect = useEditorStore((s) => s.exportAspect)
  const exportRes = useEditorStore((s) => s.exportRes)
  const customSize = useEditorStore((s) => s.customSize)
  const editor = useEditorStore.getState()

  const [w, h] = exportDimensions(exportAspect, exportRes, customSize)

  return (
    <Section title="Format">
      <Row label="Quality">
        <Segmented
          options={[
            { value: '720', label: '720p' },
            { value: '1080', label: '1080p' },
            { value: 'custom', label: 'Custom' },
          ]}
          value={String(exportRes)}
          onChange={(v) => editor.setExportRes(v === 'custom' ? 'custom' : (Number(v) as ExportRes))}
        />
      </Row>
      {exportRes !== 'custom' ? (
        <Row label="Aspect">
          <Segmented<ExportAspect>
            options={[
              { value: '16:9', label: '16:9' },
              { value: '1:1', label: '1:1' },
              { value: '9:16', label: '9:16' },
            ]}
            value={exportAspect}
            onChange={editor.setExportAspect}
          />
        </Row>
      ) : (
        <Row label="Size">
          <NumberInput
            prefix="W"
            step={2}
            value={customSize[0]}
            onChange={(v) => editor.setCustomSize([v, customSize[1]])}
          />
          <NumberInput
            prefix="H"
            step={2}
            value={customSize[1]}
            onChange={(v) => editor.setCustomSize([customSize[0], v])}
          />
        </Row>
      )}
      <div className="text-[10px] text-ink-dim">
        Output: {w} × {h}px — used by the video export and the preview guides
      </div>
    </Section>
  )
}

function TargetSections() {
  const target = useRigStore((s) => s.target)
  const rig = useRigStore.getState()
  return (
    <Section title="Look-At Target">
      <Row label="Height">
        <Slider
          value={target[1]}
          onChange={(y) => rig.setTarget([target[0], y, target[2]])}
          min={0}
          max={8}
          step={0.1}
          format={meters}
        />
      </Row>
      <Row label="Position">
        <XYZInput
          value={target}
          onChange={(axis, v) => {
            const next = [...target] as Vec3
            next[axis] = v
            rig.setTarget(next)
          }}
        />
      </Row>
    </Section>
  )
}

function SceneSections() {
  const bgColor = useSceneStore((s) => s.bgColor)
  const setBgColor = useSceneStore((s) => s.setBgColor)
  const showGrid = useSceneStore((s) => s.showGrid)
  const setShowGrid = useSceneStore((s) => s.setShowGrid)
  const hasCameraPath = usePathStore(
    (s) => (s.paths.find((path) => path.id === CAMERA_PATH_ID)?.anchors.length ?? 0) >= 2,
  )

  return (
    <>
      {/* The ready-made moves and the path options only existed under the
          "Camera Path" item in the outliner, so with nothing selected — where you
          land — there was no sign the app could build a move for you. */}
      <Section title="Camera move">
        <div className="grid grid-cols-2 gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.kind}
              onClick={() => {
                applyCameraPreset(preset.kind)
                useEditorStore.getState().select(CAMERA_PATH_ID)
              }}
              title={preset.hint}
              className="rounded-md bg-panel-2 px-2 py-1.5 text-[11px] text-ink hover:bg-panel-3"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <PanelButton
          label={hasCameraPath ? 'Path options & keyframes' : 'Draw a path (P)'}
          onClick={() => {
            if (hasCameraPath) useEditorStore.getState().select(CAMERA_PATH_ID)
            else useEditorStore.getState().setTool('pen')
          }}
        />
      </Section>
      <Section title="Scene">
      <Row label="Background">
        <ColorField value={bgColor} onChange={setBgColor} />
      </Row>
      <Row label="Grid">
        <Segmented
          options={[
            { value: 'show', label: 'Show' },
            { value: 'hide', label: 'Hide' },
          ]}
          value={showGrid ? 'show' : 'hide'}
          onChange={(v) => setShowGrid(v === 'show')}
        />
      </Row>
      </Section>
    </>
  )
}

export function RightPanel() {
  const selection = useEditorStore((s) => s.selection)
  const tool = useEditorStore((s) => s.tool)
  const tab = useEditorStore((s) => s.panelTab)
  const setTab = useEditorStore((s) => s.setPanelTab)

  return (
    <div
      className={`panel absolute bottom-3 right-3 top-3 z-20 flex flex-col overflow-hidden ${
        tab === 'assistant' ? 'w-80' : 'w-60'
      }`}
    >
      <div className="flex items-center gap-1 border-b border-line/60 px-2 py-2">
        {(
          [
            { value: 'design', label: 'Design' },
            { value: 'assistant', label: 'Assistant' },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            onClick={() => setTab(option.value)}
            className={`rounded-md px-2.5 py-1 text-[11px] ${
              tab === option.value ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
        <button
          onClick={() => useEditorStore.getState().setShowSettings(true)}
          className="ml-auto rounded-md px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
          title="Settings (API keys, guidelines)"
        >
          ⚙
        </button>
      </div>

      {tab === 'assistant' ? (
        <AssistantPanel />
      ) : (
        <>
          {tool === 'pen' && (
            <div className="border-b border-line/60 bg-accent/10 px-3 py-2.5 text-[11px] leading-relaxed text-ink">
              <span className="font-medium text-accent">Pen:</span> click to add a point;
              click and drag to curve it. Click the 1st point to close the loop.{' '}
              <kbd>Enter</kbd>/<kbd>Esc</kbd> to finish.
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {selection?.startsWith('obj:') && <ObjectSections objectId={selection.slice(4)} />}
            {selection === 'light' && <LightSections />}
            {selection === 'camera-path' && <PathSections />}
            {selection === 'cinema-camera' && <CinemaCameraSections />}
            {selection === 'target' && <TargetSections />}
            {selection === null && <SceneSections />}
          </div>
        </>
      )}
    </div>
  )
}
