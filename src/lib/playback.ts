import { useRigStore } from '../state/useRigStore'

const PLAYHEAD_END_EPS = 1e-6

export function playheadAtEnd(t: number) {
  return t >= 1 - PLAYHEAD_END_EPS
}

/** Start playback. If the playhead is already at the end, rewind first. */
export function beginPlayback(t: number): { t: number; playing: true } {
  return { t: playheadAtEnd(t) ? 0 : t, playing: true }
}

export function togglePlayback(t: number, playing: boolean): { t: number; playing: boolean } {
  if (playing) return { t, playing: false }
  return beginPlayback(t)
}

export function applyBeginPlayback() {
  const rig = useRigStore.getState()
  const next = beginPlayback(rig.t)
  if (next.t !== rig.t) rig.setT(next.t)
  rig.setPlaying(true)
}

export function applyTogglePlayback() {
  const rig = useRigStore.getState()
  const next = togglePlayback(rig.t, rig.playing)
  if (next.t !== rig.t) rig.setT(next.t)
  rig.setPlaying(next.playing)
}
