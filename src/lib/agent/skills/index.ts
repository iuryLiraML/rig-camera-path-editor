/**
 * Built-in cinematography skills. Listed (name + description) in the system
 * prompt like an MCP tool index; the agent pulls a full body on demand via
 * the load_skill tool. Project guidelines are injected separately.
 */

export interface AgentSkill {
  name: string
  description: string
  body: string
}

const drone: AgentSkill = {
  name: 'drone',
  description: 'FPV/drone-style camera work: flyovers, dives, chases, dynamic reveals with speed and altitude changes.',
  body: `# Drone / FPV camera language

Feel: fast, floaty, always moving. The camera is a pilot, not a tripod.

Recipes (world units: scene objects are ~2 units tall, floor at y=0):
- **Flyover**: start far and high on one side (~2.5-3x scene radius, height 2-3x scene height),
  pass over the top slightly off-center, exit on the opposite side lower. 3 anchors is enough;
  rounding 80-100%. Duration 4-7s. look_at mode 'motion' for true FPV feel, or 'target' to keep
  the subject framed during the pass.
- **Dive / crash-in**: 2-3 anchors from high+far to low+close (end ~1.2x radius from center at
  subject height). Add camera keyframes so the last 20% of time covers the last 40% of path
  (accelerating feel): keys like (0.6t -> 0.5p), (1.0t -> 1.0p) with smoothness 30-50%.
- **Chase / orbit-strafe**: open orbit arc (half circle preset then raise rounding), height low
  (0.5-1x subject height), duration 5-8s, look_at 'target'. Slight roll (3-8 deg) sells the bank.
- FOV 60-85 for wide FPV distortion. Higher speed = shorter duration, NOT more anchors.

Avoid: perfectly level paths (vary Y between anchors by 20-50%), constant speed on dives
(use camera keyframes), tight FOV (<50 kills the drone feel).`,
}

const packshot: AgentSkill = {
  name: 'packshot',
  description: 'Product takes and packshots: slow orbits, hero 3/4 angles, push-ins, e-commerce/advertising framing.',
  body: `# Product packshot camera language

Feel: calm, deliberate, premium. The product is the hero; the camera serves it.

Recipes (product normalized to ~2 units, floor y=0, center ~y=1):
- **Slow orbit 360**: orbit preset, then duration 12-20s, smoothness 0-20% (constant speed reads
  as "turntable"), height just above product center (1.1-1.4), radius 2-2.5x product size,
  look_at 'target' at product center. FOV 35-50 (compressed, flattering).
- **Hero 3/4 push-in**: 2 anchors on the 3/4 diagonal (45 deg from front), far->near
  (2.5x -> 1.3x radius), height slightly above center looking ~10 deg down (camera Y ≈ center
  Y + 0.3-0.6, target at center). Duration 6-10s, smoothness 70-100% (soft start/stop).
- **Reveal hold**: any move + two camera keyframes with the SAME progress at the end
  (e.g. 0.8t->1.0p and 1.0t->1.0p) = the camera arrives and HOLDS the final frame for the
  last 20% - ideal for logo/pack readability.
- **Top-down detail**: flyover preset flattened (all anchors high, small radius), slow.

Avoid: wide FOV (>55 distorts the pack), fast moves, paths that cross in front of the label
at close distance, camera below product center (unheroic) unless brutalist look is requested.`,
}

const orbitReveal: AgentSkill = {
  name: 'orbit-reveal',
  description: 'Reveal moves: start behind/low/obscured, rise and orbit into a frontal hero framing with a hold.',
  body: `# Orbit reveal

Structure: 3 acts on one path - (1) start where the subject reads poorly (behind, low, or
grazing the floor), (2) sweep around/up, (3) land on the hero angle and hold.

Recipe:
- Custom path (set_camera_path): anchor A behind the subject, low (y 0.3-0.6), radius ~2x;
  anchor B at the side, rising (y 1.2-1.8), radius 2.2x; anchor C at front 3/4, y 1.2-1.5,
  radius 1.6-1.8x. closed=false, rounding 80-100%.
- Camera keyframes for the hold: (0.75t -> 1.0p) + (1.0t -> 1.0p). Smoothness 60-90%.
- look_at 'target' at subject center the whole time. Duration 8-12s. FOV 40-50.
- Optional: pose keyframes to slowly spin the object AGAINST the camera direction (subtle,
  ~45-90 deg total) - doubles the perceived motion without speeding the camera.`,
}

const dollyPush: AgentSkill = {
  name: 'dolly-push',
  description: 'Straight-line dolly moves: push-in for drama/focus, pull-back for context/reveal-of-scale.',
  body: `# Dolly push-in / pull-back

- **Push-in**: 2 anchors on a straight line toward the subject (dolly preset is the base).
  Far anchor 2.5-3x radius, near anchor 1.2-1.5x. Height constant at subject center or slightly
  above. Duration 5-8s, smoothness 80-100% (ease both ends). look_at 'target'.
- **Pull-back reveal**: same reversed - use camera keyframes (0t -> 1.0p, 1t -> 0.0p) to play an
  existing path backwards instead of rebuilding it.
- **Creep**: very slow push (duration 15-20s, distance change only ~20%) - background tension.
- FOV: tighter (35-45) compresses and feels premium; wider (60+) feels documentary.
- Never curve a dolly: rounding 0% or only 2 anchors, otherwise it reads as a failed orbit.`,
}

export const AGENT_SKILLS: AgentSkill[] = [drone, packshot, orbitReveal, dollyPush]

export function getSkill(name: string): AgentSkill | undefined {
  return AGENT_SKILLS.find((s) => s.name === name)
}
