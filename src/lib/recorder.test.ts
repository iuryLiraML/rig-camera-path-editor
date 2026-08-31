// @vitest-environment jsdom

import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeObject, useSceneStore } from '../state/useSceneStore'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
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

import { cancelRecording, captureShotStill, encodePassVideos } from './recorder'

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
  useRigStore.setState({ duration: 0.1, fps: 24, t: 0.35, playing: false })
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
