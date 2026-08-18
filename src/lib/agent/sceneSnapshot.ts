import { cinemaChannelsFromRig } from '../cinemaChannels'
import { evaluateCinemaPose } from '../evaluateCinemaPose'
import { aabbFromCenterSize, aspectFromExport, type Aabb } from './framing'
import { CAMERA_PATH_ID, usePathStore } from '../../state/usePathStore'
import { cameraPath } from '../../state/cameraPathLink'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore } from '../../state/useSceneStore'
import { useEditorStore } from '../../state/useEditorStore'
import { objectGroups } from '../../viewport/SceneObjects'
import * as THREE from 'three'
import type { Vec3 } from '../../state/useSceneStore'
import type { CinemaSample, JudgeInput } from './codeJudge'
import type { JudgeReport, ShotPlan } from './shotTypes'
import type { SubjectCandidate } from './parseShotPlan'

const SAMPLE_T = [0, 0.5, 1]

export function objectCandidates(): SubjectCandidate[] {
  const scene = useSceneStore.getState()
  const box = new THREE.Box3()
  const size = new THREE.Vector3()
  return scene.objects.map((o) => {
    const group = objectGroups.get(o.id)
    let area = 0
    let height = o.transform.scale[1]
    if (group) {
      group.updateWorldMatrix(true, true)
      box.setFromObject(group)
      box.getSize(size)
      area = size.x * size.z
      height = size.y
    }
    const isFloorish =
      /floor|ground|plane|backdrop/i.test(o.name) ||
      (o.primitive?.kind === 'plane' && height < 0.25)
    return { id: o.id, name: o.name, area, isFloorish }
  })
}

export function selectedObjectId(): string | null {
  const selection = useEditorStore.getState().selection
  if (selection && selection.startsWith('obj:')) return selection.slice(4)
  return null
}

export function subjectAabb(subjectId: string): Aabb | null {
  const group = objectGroups.get(subjectId)
  const object = useSceneStore.getState().objects.find((o) => o.id === subjectId)
  if (group) {
    const box = new THREE.Box3()
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    group.updateWorldMatrix(true, true)
    box.setFromObject(group)
    box.getSize(size)
    box.getCenter(center)
    return aabbFromCenterSize(
      [center.x, center.y, center.z],
      [size.x, size.y, size.z],
    )
  }
  if (!object) return null
  const s = object.transform.scale
  return aabbFromCenterSize(object.transform.position, [Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])])
}

export function buildJudgeInput(plan: ShotPlan): JudgeInput {
  const path = cameraPath()
  const rig = useRigStore.getState()
  const scene = useSceneStore.getState()
  const aspect = aspectFromExport(useEditorStore.getState().exportAspect)
  const channels = cinemaChannelsFromRig(rig, {
    objects: scene.objects,
    paths: usePathStore.getState().paths,
  })
  const pathInput = {
    anchors: path?.anchors ?? [],
    closed: path?.closed ?? false,
    rounding: path?.rounding ?? 0.8,
  }
  const samples: Array<CinemaSample | null> = SAMPLE_T.map((t) => {
    const pose = evaluateCinemaPose(t, pathInput, channels)
    if (!pose) return null
    return {
      t,
      position: pose.position,
      fov: pose.fov,
      roll: rig.roll,
      lookTarget: pose.lookTarget,
    }
  })
  const pathAnchors: Vec3[] = (path?.anchors ?? []).map((a) => a.position)
  return {
    plan,
    subject: subjectAabb(plan.subject_id),
    samples,
    pathAnchors,
    aspect,
  }
}

export function formatJudgeReport(report: JudgeReport): string {
  if (report.pass) return 'PASS'
  return report.failures.map((f) => `${f.code}: ${f.message}`).join('\n')
}

export { CAMERA_PATH_ID }
