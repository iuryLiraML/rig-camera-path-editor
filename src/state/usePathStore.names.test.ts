import { beforeEach, describe, expect, it } from 'vitest'
import { CAMERA_PATH_ID, usePathStore } from './usePathStore'

beforeEach(() => {
  usePathStore.setState({
    paths: [
      { id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 },
    ],
    activePathId: CAMERA_PATH_ID,
  })
})

describe('path display names', () => {
  it('gives a second duplicate a unique display name', () => {
    const road = usePathStore.getState().createPath('Road')
    const first = usePathStore.getState().duplicatePath(road)
    const second = usePathStore.getState().duplicatePath(road)

    expect(usePathStore.getState().getPath(road)?.name).toBe('Road')
    expect(usePathStore.getState().getPath(first)?.name).toBe('Road copy')
    expect(usePathStore.getState().getPath(second)?.name).toBe('Road copy 2')
  })

  it('uniquifies a Camera Path duplicate without changing its id', () => {
    const first = usePathStore.getState().duplicatePath(CAMERA_PATH_ID)
    const second = usePathStore.getState().duplicatePath(CAMERA_PATH_ID)
    const camera = usePathStore.getState().getPath(CAMERA_PATH_ID)

    expect(camera?.id).toBe(CAMERA_PATH_ID)
    expect(camera?.name).toBe('Camera Path')
    expect(usePathStore.getState().getPath(first)?.name).toBe('Camera Path copy')
    expect(usePathStore.getState().getPath(second)?.name).toBe('Camera Path copy 2')
    expect(first).not.toBe(CAMERA_PATH_ID)
    expect(second).not.toBe(CAMERA_PATH_ID)
  })
})
