export type SamImageVersion = '3.1' | '3.0'

export const SAM_IMAGE_MODELS = {
  '3.1': 'fal-ai/sam-3-1/image',
  '3.0': 'fal-ai/sam-3/image',
} as const

export const SAM_3D_BODY = 'fal-ai/sam-3/3d-body'
export const SAM_3D_OBJECTS = 'fal-ai/sam-3/3d-objects'
