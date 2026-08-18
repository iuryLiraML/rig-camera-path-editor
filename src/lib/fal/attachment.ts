/** Sticky chat attachment for photo lift and video performance. Session-only. */

export type LiftAttachmentKind = 'person' | 'prop' | 'person-video'

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i

let attachment: File | null = null
const lastLiftIds: Partial<Record<LiftAttachmentKind, string[]>> = {}

export function isVideoFile(file: File | null | undefined): boolean {
  if (!file) return false
  if (file.type.toLowerCase().startsWith('video/')) return true
  return VIDEO_EXT.test(file.name)
}

export function isVideoFilename(name: string | null | undefined): boolean {
  if (!name) return false
  return VIDEO_EXT.test(name)
}

export function setLiftAttachment(file: File | null) {
  attachment = file
  if (!file) {
    delete lastLiftIds.person
    delete lastLiftIds.prop
    delete lastLiftIds['person-video']
  }
}

export function getLiftAttachment(): File | null {
  return attachment
}

export function isVideoAttachment(): boolean {
  return isVideoFile(attachment)
}

export function peekLastLifts(kind: LiftAttachmentKind): string[] {
  return lastLiftIds[kind] ?? []
}

export function recordLifts(kind: LiftAttachmentKind, objectIds: string[]) {
  lastLiftIds[kind] = [...objectIds]
}

/** Test / New-conversation cleanup. Does not run after a successful lift. */
export function consumeLiftAttachment(): File | null {
  const file = attachment
  setLiftAttachment(null)
  return file
}
