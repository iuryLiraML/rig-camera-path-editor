import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useCameraReady } from '../../state/cameraPathLink'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { usePathStore } from '../../state/usePathStore'
import { useSceneStore } from '../../state/useSceneStore'
import {
  evalProgress,
  evalValue,
  evalVec3,
} from '../../lib/keyframes'
import {
  normalizeInRange,
  plotRange,
  RANGE_FOV,
  RANGE_LOOK,
  RANGE_PROGRESS,
  RANGE_ROLL,
  RANGE_UNIT,
  type ValueRange,
} from '../../lib/lanePlot'
import {
  formatTimecode,
  panTimeView,
  rulerMarks,
  shotFrameCount,
  timeInView,
  timeToX,
  TIMELINE_FPS,
  wheelZoomFactor,
  zoomAround,
} from '../../lib/timeView'
import { FX_PARAM_CHANNELS } from '../cameraChannels'
import { GraphEditor, buildGraphChannels } from '../GraphEditor'
import { sampleOverTime } from '../TrackCurve'
import { applyCameraPreset, PRESETS } from '../../lib/presets'
import { GUTTER, chromeBand, useViewportInsets, useWindowSize } from '../viewportInsets'
import { DockResizeHandle } from './DockResizeHandle'
import { ShotStrip } from './ShotStrip'
import { TimelineRuler, TimeNavigator } from './TimelineRuler'
import { progressLaneKeys, TimelineTracks } from './TimelineTracks'
import { TimelineTransport } from './TimelineTransport'
import { TimeViewCtx, timeFromEvent, TIMELINE_HEIGHT } from './timelineShared'

export { TIMELINE_HEIGHT }

function EmptyPathBody() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-between gap-4 px-3 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-ink">No camera path yet</p>
        <p className="mt-1 text-[10px] leading-4 text-ink-dim">
          The timeline, keyframes and video export need a path. Pick a ready-made move or draw
          your own with the pen tool (P).
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.kind}
            onClick={() => applyCameraPreset(preset.kind)}
            title={preset.hint}
            className="rounded-md bg-panel-2 px-2.5 py-1 text-[11px] text-ink hover:bg-panel-3"
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => useEditorStore.getState().setTool('pen')}
          title="Draw the camera path by clicking in the viewport"
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/85"
        >
          Draw path (P)
        </button>
      </div>
    </div>
  )
}

/**
 * Compose bottom dock: shot filmstrip + the active shot's After Effects timeline.
 * Hook order is fixed — plot memos run before the empty-path return so a path
 * appearing later cannot crash the editor.
 */
export function ComposeDock() {
  const hasPath = useCameraReady()
  const playing = useRigStore((s) => s.playing)
  const t = useRigStore((s) => s.t)
  const duration = useRigStore((s) => s.duration)
  const loop = useRigStore((s) => s.loop)
  const ease = useRigStore((s) => s.ease)
  const progressKeys = useRigStore((s) => s.progressKeys)
  const fovKeys = useRigStore((s) => s.fovKeys)
  const rollKeys = useRigStore((s) => s.rollKeys)
  const intensityKeys = useRigStore((s) => s.intensityKeys)
  const fadeInKeys = useRigStore((s) => s.fadeInKeys)
  const fadeOutKeys = useRigStore((s) => s.fadeOutKeys)
  const ampPosKeys = useRigStore((s) => s.ampPosKeys)
  const ampRotKeys = useRigStore((s) => s.ampRotKeys)
  const freqKeys = useRigStore((s) => s.freqKeys)
  const targetKeys = useRigStore((s) => s.targetKeys)
  const lookOffsetKeys = useRigStore((s) => s.lookOffsetKeys)
  const staticPosKeys = useRigStore((s) => s.staticPosKeys)
  const staticRotKeys = useRigStore((s) => s.staticRotKeys)
  const cameraKind = useRigStore((s) => s.cameraKind)
  const staticPose = useRigStore((s) => s.staticPose)
  const fov = useRigStore((s) => s.fov)
  const roll = useRigStore((s) => s.roll)
  const target = useRigStore((s) => s.target)
  const lookOffset = useRigStore((s) => s.lookOffset)
  const targetObjectId = useRigStore((s) => s.targetObjectId)
  const cameraNoise = useRigStore((s) => s.cameraNoise)
  const objects = useSceneStore((s) => s.objects)
  const paths = usePathStore((s) => s.paths)
  const playMode = useEditorStore((s) => s.playMode)
  const timelineView = useEditorStore((s) => s.timelineView)
  const selectedKeyframe = useEditorStore((s) => s.selectedKeyframe)
  const timelineGraph = useEditorStore((s) => s.timelineGraph)

  const insets = useViewportInsets()
  const win = useWindowSize()
  const band = chromeBand(insets, win.w)
  const scrubbing = useRef(false)
  const rulerRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)

  /*
   * Every hook must run before the early returns below. These sat after the
   * "no camera path" return, so the component ran fewer hooks while empty and
   * more once a path existed — React threw "Rendered more hooks than during the
   * previous render" and unmounted the whole editor to a blank screen.
   */
  const progressPlot = useMemo(() => {
    const values = sampleOverTime((time) => evalProgress(time, progressKeys, ease))
    const range = plotRange(
      [...values, ...progressKeys.map((k) => k.progress)],
      RANGE_PROGRESS,
    )
    return { curve: normalizeInRange(values, range), range }
  }, [progressKeys, ease])
  const fovPlot = useMemo(() => {
    const values = sampleOverTime((time) => evalValue(time, fovKeys, fov, ease))
    const range = plotRange([...values, ...fovKeys.map((k) => k.value)], RANGE_FOV)
    return { curve: normalizeInRange(values, range), range }
  }, [fovKeys, fov, ease])
  const rollPlot = useMemo(() => {
    const values = sampleOverTime((time) => evalValue(time, rollKeys, roll, ease))
    const range = plotRange([...values, ...rollKeys.map((k) => k.value)], RANGE_ROLL)
    return { curve: normalizeInRange(values, range), range }
  }, [rollKeys, roll, ease])
  const targetPlot = useMemo(() => {
    const values = sampleOverTime((time) => evalVec3(time, targetKeys, target, ease)[1])
    const range = plotRange([...values, ...targetKeys.map((k) => k.value[1])], RANGE_LOOK)
    return { curve: normalizeInRange(values, range), range }
  }, [targetKeys, target, ease])
  const lookOffsetPlot = useMemo(() => {
    const values = sampleOverTime((time) => evalVec3(time, lookOffsetKeys, lookOffset, ease)[1])
    const range = plotRange([...values, ...lookOffsetKeys.map((k) => k.value[1])], RANGE_LOOK)
    return { curve: normalizeInRange(values, range), range }
  }, [lookOffsetKeys, lookOffset, ease])
  const staticPosPlot = useMemo(() => {
    const values = sampleOverTime((time) =>
      evalVec3(time, staticPosKeys, staticPose.position, ease)[1],
    )
    const range = plotRange([...values, ...staticPosKeys.map((k) => k.value[1])], RANGE_LOOK)
    return { curve: normalizeInRange(values, range), range }
  }, [staticPosKeys, staticPose.position, ease])
  const staticRotPlot = useMemo(() => {
    const values = sampleOverTime((time) =>
      evalVec3(time, staticRotKeys, staticPose.rotation, ease)[1],
    )
    const range = plotRange([...values, ...staticRotKeys.map((k) => k.value[1])], RANGE_ROLL)
    return { curve: normalizeInRange(values, range), range }
  }, [staticRotKeys, staticPose.rotation, ease])
  const intensityPlot = useMemo(() => {
    const values = sampleOverTime((time) =>
      evalValue(time, intensityKeys, cameraNoise.intensity, ease),
    )
    const range = plotRange([...values, ...intensityKeys.map((k) => k.value)], RANGE_UNIT)
    return { curve: normalizeInRange(values, range), range }
  }, [intensityKeys, cameraNoise.intensity, ease])
  const fxParamBag = {
    fadeIn: fadeInKeys,
    fadeOut: fadeOutKeys,
    ampPos: ampPosKeys,
    ampRot: ampRotKeys,
    freq: freqKeys,
  }
  const fxParamFallback = {
    fadeIn: cameraNoise.fadeIn,
    fadeOut: cameraNoise.fadeOut,
    ampPos: cameraNoise.ampPos,
    ampRot: cameraNoise.ampRot,
    freq: cameraNoise.freq,
  }
  const fxParamPlots = useMemo(() => {
    const plots: Partial<Record<keyof typeof fxParamBag, { curve: number[]; range: ValueRange }>> = {}
    for (const channel of FX_PARAM_CHANNELS) {
      const keys = fxParamBag[channel.id]
      const values = sampleOverTime((time) =>
        evalValue(time, keys, fxParamFallback[channel.id], ease),
      )
      const range = plotRange([...values, ...keys.map((k) => k.value)], RANGE_UNIT)
      plots[channel.id] = { curve: normalizeInRange(values, range), range }
    }
    return plots
  }, [fadeInKeys, fadeOutKeys, ampPosKeys, ampRotKeys, freqKeys, cameraNoise, ease])

  const applyWheelZoom = (e: { deltaX: number; deltaY: number; shiftKey: boolean; clientX: number; preventDefault: () => void }) => {
    const lane = rulerRef.current
    if (!lane) return
    e.preventDefault()
    const view = useEditorStore.getState().timelineView
    const pan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.25
    if (pan) {
      const pixels = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      useEditorStore
        .getState()
        .setTimelineView(panTimeView(view, (pixels / Math.max(1, lane.clientWidth)) * view.span))
      return
    }
    useEditorStore
      .getState()
      .setTimelineView(zoomAround(view, timeFromEvent(e, lane, view), wheelZoomFactor(e.deltaY)))
  }

  useEffect(() => {
    const dock = dockRef.current
    if (!dock) return
    const onWheel = (e: WheelEvent) => applyWheelZoom(e)
    dock.addEventListener('wheel', onWheel, { passive: false })
    return () => dock.removeEventListener('wheel', onWheel)
  }, [hasPath, playMode])

  if (playMode) return null

  const scrub = (e: ReactPointerEvent) => {
    if (!rulerRef.current) return
    useRigStore.getState().setPlaying(false)
    useRigStore.getState().setT(timeFromEvent(e, rulerRef.current, timelineView))
  }

  const ticks = rulerMarks(duration, timelineView, TIMELINE_FPS)
  const playX = timeToX(t, timelineView)
  const frameCount = shotFrameCount(duration, TIMELINE_FPS)

  return (
    <TimeViewCtx.Provider value={timelineView}>
      <div
        ref={dockRef}
        data-timeline-dock
        className="panel absolute z-20 flex flex-col overflow-hidden"
        style={{ left: band.left, width: band.width, bottom: GUTTER, height: insets.timelineHeight }}
        onWheel={(e) => applyWheelZoom(e)}
      >
        <DockResizeHandle />
        <ShotStrip />
        {hasPath ? (
          <>
            <TimelineTransport
              playing={playing}
              t={t}
              duration={duration}
              loop={loop}
              ease={ease}
              frameCount={frameCount}
            />
            <TimelineRuler
              rulerRef={rulerRef}
              ticks={ticks}
              view={timelineView}
              onScrubStart={(e) => {
                scrubbing.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
                scrub(e)
              }}
              onScrub={(e) => {
                if (scrubbing.current) scrub(e)
              }}
              onScrubEnd={(e) => {
                scrubbing.current = false
                try {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                } catch {
                  /* pointer may be gone */
                }
              }}
            />
            <div className={`relative min-h-0 flex-1 px-3 ${timelineGraph ? 'overflow-hidden' : 'overflow-y-auto'}`}>
              {timelineGraph ? (
                <GraphEditor
                  channels={buildGraphChannels({
                    duration,
                    progressKeys: progressLaneKeys(progressKeys, duration),
                    progressPlot,
                    intensityKeys,
                    intensityPlot,
                    fxParamBag,
                    fxParamPlots,
                    cameraNoiseEnabled: cameraNoise.enabled,
                    fovKeys,
                    rollKeys,
                    targetKeys,
                    lookOffsetKeys,
                    channelPlots: {
                      fov: fovPlot,
                      roll: rollPlot,
                      target: targetPlot,
                      lookOffset: lookOffsetPlot,
                    },
                    tracking: Boolean(
                      targetObjectId && objects.some((object) => object.id === targetObjectId),
                    ),
                    staticPosKeys,
                    staticRotKeys,
                    staticPosPlot,
                    staticRotPlot,
                  })}
                  defaultEase={ease}
                />
              ) : (
                <TimelineTracks
                  cameraKind={cameraKind}
                  t={t}
                  duration={duration}
                  ease={ease}
                  progressKeys={progressKeys}
                  fovKeys={fovKeys}
                  rollKeys={rollKeys}
                  intensityKeys={intensityKeys}
                  targetKeys={targetKeys}
                  lookOffsetKeys={lookOffsetKeys}
                  staticPosKeys={staticPosKeys}
                  staticRotKeys={staticRotKeys}
                  staticPose={staticPose}
                  fov={fov}
                  roll={roll}
                  targetObjectId={targetObjectId}
                  cameraNoise={cameraNoise}
                  objects={objects}
                  paths={paths}
                  selectedKeyframe={selectedKeyframe}
                  progressPlot={progressPlot}
                  fovPlot={fovPlot}
                  rollPlot={rollPlot}
                  targetPlot={targetPlot}
                  lookOffsetPlot={lookOffsetPlot}
                  staticPosPlot={staticPosPlot}
                  staticRotPlot={staticRotPlot}
                  intensityPlot={intensityPlot}
                  fxParamBag={fxParamBag}
                  fxParamPlots={fxParamPlots}
                />
              )}
              {timeInView(t, timelineView) && (
                <div
                  className="pointer-events-none absolute bottom-0 top-[-28px]"
                  style={{
                    left: `calc(11.5rem + (100% - 11.5rem - 2rem) * ${playX})`,
                  }}
                >
                  <div className="absolute bottom-0 top-0 w-px bg-accent" />
                  <div className="absolute -top-0.5 -translate-x-1/2 rounded bg-accent px-1 py-px text-[9px] font-medium tabular-nums text-white">
                    {formatTimecode(t, duration)}
                  </div>
                </div>
              )}
            </div>
            <div className="px-3 pb-2">
              <TimeNavigator
                view={timelineView}
                onChange={(view) => useEditorStore.getState().setTimelineView(view)}
              />
            </div>
          </>
        ) : (
          <EmptyPathBody />
        )}
      </div>
    </TimeViewCtx.Provider>
  )
}
