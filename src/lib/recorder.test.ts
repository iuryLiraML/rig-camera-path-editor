// @vitest-environment jsdom

import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeObject, useSceneStore } from '../state/useSceneStore'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { usePathStore, CAMERA_PATH_ID, makeAnchor } from '../state/usePathStore'
import { downloadBlob } from './mp4Encode'
import { applyAssetDisplay } from './assetDisplay'
import { renderBridge } from './renderBridge'

const encoderControl = vi.hoisted(() => ({ fail: false }))

vi.mock('mp4-muxer', () => ({
  ArrayBufferTarget: class {
    buffer = new ArrayBuffer(8)
  },
  Muxer: class {
    target: { buffer: ArrayBuffer }
    constructor(options: { target: { buffer: ArrayBuffer } }) {
      this.target = options.target
    }
    addVideoChunk() {}
    finalize() {}
  },
}))

vi.mock('./mp4Encode', async (importOriginal) => {
  const original = await importOriginal<typeof import('./mp4Encode')>()
  return {
    ...original,
    avcCodecString: () => 'avc1.test',
    downloadBlob: vi.fn(),
    sleepMs: async () => {},
  }
})

import { cancelRecording, captureShotStill, encodePassVideos, exportVideo, exportFrame } from './recorder'

class FakeVideoEncoder {
  state = 'configured'
  encodeQueueSize = 0
  private readonly onError: (error: Error) => void

  constructor(init: { error: (error: Error) => void }) {
    this.onError = init.error
  }

  configure() {}

  encode() {
    if (encoderControl.fail) this.onError(new Error('encoder failed'))
  }

  async flush() {}

  close() {
    this.state = 'closed'
  }
}

class FakeVideoFrame {
  close() {}
}

function firstMesh(root: THREE.Object3D) {
  let mesh: THREE.Mesh | undefined
  root.traverse((child) => {
    if (!mesh && child instanceof THREE.Mesh) mesh = child
  })
  return mesh!
}

function wireframeObject() {
  const source = new THREE.MeshStandardMaterial({ color: 0x444444 })
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), source))
  const object = makeObject('Wire', root, { id: 'wire', displayMode: 'wireframe' })
  const solidSource = new THREE.MeshStandardMaterial({ color: 0x777777 })
  const solidRoot = new THREE.Group()
  solidRoot.add(new THREE.Mesh(new THREE.SphereGeometry(1), solidSource))
  const solid = makeObject('Solid', solidRoot, { id: 'solid' })
  applyAssetDisplay(object, 'look')
  applyAssetDisplay(solid, 'look')
  useSceneStore.setState({ objects: [object, solid] })
  return { object, source, solid, solidSource }
}

beforeEach(() => {
  document.body.innerHTML = '<canvas></canvas>'
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ drawImage: vi.fn() }),
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    value: (callback: BlobCallback) => callback(new Blob(['frame'])),
  })
  vi.stubGlobal('VideoEncoder', FakeVideoEncoder)
  vi.stubGlobal('VideoFrame', FakeVideoFrame)
  encoderControl.fail = false
  useEditorStore.setState({
    recording: false,
    selection: null,
    viewMode: 'look',
    exportPasses: ['look'],
    exportRes: 'custom',
    customSize: [16, 16],
  })
  useRigStore.setState({ cameraKind: 'static', duration: 0.1, fps: 24, t: 0.35, playing: false })
  vi.mocked(downloadBlob).mockClear()
  renderBridge.setFrameloop = vi.fn()
})

afterEach(() => {
  renderBridge.advance = null
  renderBridge.setFrameloop = null
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('offline asset display isolation', () => {
  it.each(['success', 'failure', 'cancel'] as const)('restores the complete edit context after capture %s', async (outcome) => {
    wireframeObject()
    const anchor = makeAnchor([1, 2, 3])
    usePathStore.setState({ paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [anchor], closed: false, rounding: 0.8 }], activePathId: CAMERA_PATH_ID })
    useEditorStore.getState().selectMany(['obj:wire', 'obj:solid'])
    usePathStore.getState().selectAnchor(anchor.id)
    const paths = usePathStore.getState()
    const selection = useEditorStore.getState().selectionIds
    const anchorSelection = paths.selectedAnchorIds
    useEditorStore.setState({ playMode: true, selectedKeyframe: { kind: 'rig', channel: 'fov', id: 'key' } })
    const keyframe = useEditorStore.getState().selectedKeyframe
    renderBridge.advance = vi.fn(() => {
      if (outcome === 'failure') throw new Error('capture failed')
      if (outcome === 'cancel') cancelRecording()
    })
    if (outcome === 'failure') await expect(captureShotStill()).rejects.toThrow('capture failed')
    else await captureShotStill()
    expect(useEditorStore.getState().selectionIds).toEqual(selection)
    expect(usePathStore.getState().selectedAnchorIds).toEqual(anchorSelection)
    expect(useEditorStore.getState().selectedKeyframe).toEqual(keyframe)
    expect(useEditorStore.getState().playMode).toBe(true)
    expect(useRigStore.getState().t).toBe(0.35)
  })
  it('captures stills and MP4 frames as Solid, then restores Wireframe', async () => {
    const { object, source, solid, solidSource } = wireframeObject()
    renderBridge.advance = vi.fn(() => {
      expect(firstMesh(object.root).material).toBe(source)
      expect(firstMesh(solid.root).material).toBe(solidSource)
      expect(object.displayMode).toBe('wireframe')
      expect(solid.displayMode).toBe('solid')
    })

    await expect(captureShotStill()).resolves.toBeInstanceOf(Blob)
    expect(firstMesh(object.root).material).toBe(object.wireframeMaterial)
    expect(firstMesh(solid.root).material).toBe(solidSource)

    const videos = await encodePassVideos()
    expect(videos).toHaveLength(1)
    expect(firstMesh(object.root).material).toBe(object.wireframeMaterial)
    expect(firstMesh(solid.root).material).toBe(solidSource)
  })

  it('restores Wireframe when a still capture throws', async () => {
    const { object, source } = wireframeObject()
    renderBridge.advance = vi.fn(() => {
      expect(firstMesh(object.root).material).toBe(source)
      throw new Error('capture failed')
    })

    await expect(captureShotStill()).rejects.toThrow('capture failed')
    expect(firstMesh(object.root).material).toBe(object.wireframeMaterial)
    expect(object.displayMode).toBe('wireframe')
  })

  it('restores Wireframe after MP4 cancellation and encoder failure', async () => {
    const { object, source } = wireframeObject()
    renderBridge.advance = vi.fn(() => {
      expect(firstMesh(object.root).material).toBe(source)
      cancelRecording()
    })
    await expect(encodePassVideos()).resolves.toBeNull()
    expect(firstMesh(object.root).material).toBe(object.wireframeMaterial)

    encoderControl.fail = true
    renderBridge.advance = vi.fn(() => {
      expect(firstMesh(object.root).material).toBe(source)
    })
    await expect(encodePassVideos()).resolves.toBeNull()
    expect(firstMesh(object.root).material).toBe(object.wireframeMaterial)
    expect(object.displayMode).toBe('wireframe')
  })
})


describe('browser recording fallback', () => {
  it.each(['success', 'cancel', 'constructor failure'] as const)('restores state and streams after %s', async (outcome) => {
    vi.stubGlobal('VideoEncoder', undefined)
    const stopTrack = vi.fn()
    const capture = vi.fn(() => ({ getTracks: () => [{ stop: stopTrack }] }))
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { configurable: true, value: capture })
    class Recorder {
      static isTypeSupported(mime: string) { return mime === 'video/mp4' }
      state = 'inactive'
      onstop?: () => void
      onerror?: () => void
      ondataavailable?: (event: { data: Blob }) => void
      constructor() { if (outcome === 'constructor failure') throw new Error('recorder unavailable') }
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['video']) })
        this.onstop?.()
      }
    }
    vi.stubGlobal('MediaRecorder', Recorder)
    useEditorStore.setState({ playMode: false, exportPasses: ['clay', 'depth'], selection: 'camera-path', selectionIds: ['path:camera-path'] })
    const passes: string[] = []
    renderBridge.advance = vi.fn(() => {
      passes.push(useEditorStore.getState().viewMode)
      if (outcome === 'cancel') cancelRecording()
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await exportVideo()
    expect(useEditorStore.getState().recording).toBe(false)
    expect(useEditorStore.getState().playMode).toBe(false)
    expect(useEditorStore.getState().selectionIds).toEqual(['path:camera-path'])
    expect(useRigStore.getState().t).toBe(0.35)
    expect(capture).toHaveBeenCalledWith(24)
    expect(stopTrack).toHaveBeenCalledTimes(outcome === 'success' ? 2 : 1)
    if (outcome === 'success') {
      expect(passes).toContain('clay')
      expect(passes).toContain('depth')
      expect(vi.mocked(downloadBlob).mock.calls.map((call) => call[1])).toEqual(['camera-animation_clay.mp4', 'camera-animation_depth.mp4'])
    } else expect(downloadBlob).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('reports a PNG failure instead of announcing a successful download', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', { configurable: true, value: (callback: BlobCallback) => callback(null) })
    renderBridge.advance = vi.fn()
    const show = vi.spyOn(useSceneStore.getState(), 'showNotice')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await exportFrame()
    expect(downloadBlob).not.toHaveBeenCalled()
    expect(show).toHaveBeenLastCalledWith('Frame export failed — please try again')
    expect(useEditorStore.getState().recording).toBe(false)
  })
})
