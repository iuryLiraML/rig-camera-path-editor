import * as THREE from 'three'

/**
 * Orientation for something looking along `dir`, continuous through the poles.
 *
 * `Object3D.lookAt` builds its basis as `right = up × z`. When the view
 * direction is parallel to `up` that cross product is zero: three.js nudges z by
 * 0.0001 in an arbitrary axis, so the roll it picks is arbitrary — and the sign
 * of the residual flips as you cross the pole. Measured on the Flyover preset,
 * the camera's quaternion changed by exactly 180 degrees between two frames at
 * t=0.480, when the view direction was 0.5 degrees off straight down.
 *
 * That is not a three.js defect: with a world-fixed up reference, "which way is
 * up in frame" genuinely reverses when you pass over the pole. The fix has to
 * change the reference near the pole, which is what this does — it hands over
 * from world up to a secondary reference (for a camera, the path tangent, i.e.
 * the direction of travel), blended smoothly so there is no seam. That is also
 * what a real drone gimbal does passing overhead: the frame rotates with the
 * direction of flight instead of snapping.
 *
 * Deterministic by construction: the result depends only on the vectors passed
 * in, never on the previous frame. Carrying the up vector forward would also fix
 * the continuity, but the offline exporter renders frame by frame and scrubbing
 * jumps around, so preview and export would stop matching.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * How close to the pole (in degrees) the handover starts. This also sets how
 * gently the unavoidable 180 degrees of roll is paid out: how fast the view
 * direction crosses the band decides that. Measured on the Flyover preset (which
 * starts with the camera directly overhead, so the whole 180 is paid on the way
 * out): 25 degrees gave a worst frame of 44 degrees, 35 gives about half that.
 * Wider is smoother but deviates from plain lookAt over more of the sphere.
 */
export const POLE_BAND_DEG = 35
const POLE_COS = Math.cos(THREE.MathUtils.degToRad(POLE_BAND_DEG))

/** away from the pole this must reproduce lookAt exactly, so no shot moves */
const _dir = new THREE.Vector3()
const _alt = new THREE.Vector3()
const _up = new THREE.Vector3()
const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _upWorld = new THREE.Vector3()
const _upHandover = new THREE.Vector3()
const _cross = new THREE.Vector3()
const LOCAL_Z = new THREE.Vector3(0, 0, 1)

/** 0 at edge0, 1 at edge1, smooth in between (no derivative jump at the seam) */
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * @param dir       direction being looked along (need not be normalized)
 * @param secondary reference used in the pole band — the path tangent for a
 *                  camera on a path. Omit when there is nothing better; a world
 *                  axis is then chosen, which is continuous as long as `dir`
 *                  itself is.
 * @param out       quaternion to write
 */
export function orientationTo(
  dir: THREE.Vector3,
  secondary: THREE.Vector3 | null,
  out: THREE.Quaternion,
): THREE.Quaternion {
  _dir.copy(dir)
  if (_dir.lengthSq() < 1e-12) _dir.set(0, 0, -1)
  _dir.normalize()

  const alignment = Math.abs(_dir.dot(WORLD_UP))
  const handover = smoothstep(POLE_COS, 1, alignment)

  // outside the band nothing changes: this is lookAt, bit for bit
  if (handover <= 0) return basisFrom(WORLD_UP, out)

  // The handover reference stays usable at the pole — for a camera on a path,
  // the direction of travel.
  if (secondary && secondary.lengthSq() > 1e-12) {
    _alt.copy(secondary).normalize()
  } else {
    fallbackAxis(_alt)
  }
  if (Math.abs(_alt.dot(_dir)) > 0.999) fallbackAxis(_alt)

  upFrom(_alt, _upHandover)
  upFrom(WORLD_UP, _upWorld)

  /*
   * Build from the handover reference, then roll back toward the world-up frame
   * by the *signed* angle between the two ups, weighted so it is zero at the
   * pole and complete at the edge of the band.
   *
   * Measured on the flyover arc, the two references agree before the pole (both
   * give +X) and are opposite after it (-X vs +X): the 180 degrees are not
   * avoidable, they are what "up" does when you fly straight over the subject.
   * Spreading them over the exit half of the band turns the snap into a roll.
   *
   * Two things this deliberately does NOT do. Lerping the reference vectors
   * fails, because near-opposite vectors cancel and the roll whips at the band
   * edge. Slerping the two quaternions fails too: right after the pole they are
   * nearly antipodal, and the shortest-arc sign choice jumps (measured: an 86.7
   * degree step). A signed angle has no such ambiguity — at exactly 180 degrees
   * it is +/-pi, and there the weight is zero.
   */
  basisFromUp(_upHandover, out)
  const along = _cross.crossVectors(_upHandover, _upWorld).dot(_dir)
  const across = _upHandover.dot(_upWorld)
  const roll = Math.atan2(along, across) * (1 - handover)
  if (roll !== 0) out.multiply(_q.setFromAxisAngle(LOCAL_Z, -roll))
  return out
}

/** the world axis least aligned with the view direction */
function fallbackAxis(target: THREE.Vector3) {
  target.set(0, 0, 1)
  if (Math.abs(_dir.z) > Math.abs(_dir.x)) target.set(1, 0, 0)
}

/**
 * Basis from a reference "up", exactly as Matrix4.lookAt would: the component of
 * the reference perpendicular to the view direction, then x = up × z, y = z × x.
 * Removing the parallel component does not change up × z, so with the world-up
 * reference this is bit-identical to lookAt and existing shots do not move.
 */
function basisFrom(reference: THREE.Vector3, out: THREE.Quaternion) {
  upFrom(reference, _up)
  return basisFromUp(_up, out)
}

/** the component of `reference` perpendicular to the view direction */
function upFrom(reference: THREE.Vector3, target: THREE.Vector3) {
  target.copy(reference).addScaledVector(_dir, -reference.dot(_dir))
  if (target.lengthSq() < 1e-12) {
    fallbackAxis(target)
    target.addScaledVector(_dir, -target.dot(_dir))
  }
  return target.normalize()
}

/** basis from an already-perpendicular up; three.js cameras look down -Z */
function basisFromUp(up: THREE.Vector3, out: THREE.Quaternion) {
  _z.copy(_dir).negate()
  _x.copy(up).cross(_z).normalize()
  _y.copy(_z).cross(_x)
  _m.makeBasis(_x, _y, _z)
  return out.setFromRotationMatrix(_m)
}

const _aim = new THREE.Vector3()

/**
 * Point `object` along `dir`, then roll it about that axis.
 *
 * `facing` matters: Object3D.lookAt aims a mesh's +Z at the target but a
 * camera's -Z, so a path-following car built with the camera convention would
 * drive backwards. Negating the direction picks the other convention and leaves
 * the up vector untouched (projecting world up out of d and out of -d gives the
 * same vector).
 */
export function aimObject(
  object: THREE.Object3D,
  dir: THREE.Vector3,
  secondary: THREE.Vector3 | null,
  rollDeg = 0,
  facing: 'camera' | 'object' = 'camera',
) {
  _aim.copy(dir)
  if (facing === 'object') _aim.negate()
  orientationTo(_aim, secondary, object.quaternion)
  if (rollDeg !== 0) object.rotateZ(rollDeg * THREE.MathUtils.DEG2RAD)
}
