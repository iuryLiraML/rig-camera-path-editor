/** Playhead seconds for `mixer.setTime` — always `f(t)`, using the active clip. */
export function clipPlayheadSeconds(
  t: number,
  shotDuration: number,
  clips: { name: string; duration: number }[],
  activeClip?: string | null,
): number {
  const seconds = t * shotDuration
  const clip = clips.find((item) => item.name === activeClip) ?? clips[0]
  const length = Math.max(clip?.duration ?? 0.001, 0.001)
  return seconds % length
}
