export type SamImageVersion = '3.1' | '3.0'

export const SAM_IMAGE_MODELS = {
  '3.1': 'fal-ai/sam-3-1/image',
  '3.0': 'fal-ai/sam-3/image',
} as const

export const SAM_3D_BODY = 'fal-ai/sam-3/3d-body'
export const SAM_3D_OBJECTS = 'fal-ai/sam-3/3d-objects'
export const SAM_3D_ALIGN = 'fal-ai/sam-3/3d-align'

export const TRIPO_REMESH = 'tripo3d/tripo/remesh'
export const TRIPO_H31_TEXT_TO_3D = 'tripo3d/h3.1/text-to-3d'
export const TRIPO_SPLAT = 'tripo3d/triposplat'
/** Fal max is 262144 — that file size hangs DropInViewer on first load. */
export const TRIPO_SPLAT_GAUSSIANS = 131_072
export const MESHY_V7_IMAGE_TO_3D = 'meshy/v7/image-to-3d'
export const MESHY_MULTI_ANIMATION = 'fal-ai/meshy/rigging/multi-animation'
/** Feed-forward multi-view reconstruction. Geometry only — estimated cameras are discarded. */
export const VGGT_1B = 'fal-ai/vggt-1b'

/** Clay-friendly cap so Generate does not immediately trip the remesh warning. */
export const GENERATE_FACE_LIMIT = 15_000
export const MESHY_TARGET_POLYCOUNT = 20_000
