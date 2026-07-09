import { useEffect } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useEditorStore, type ViewMode } from '../state/useEditorStore'
import { sceneBounds } from './SceneObjects'

export const isTechMode = (mode: ViewMode) => mode !== 'clay'

// ---------------------------------------------------------------------------
// Depth window: near/far follow the active camera around the scene so the
// grayscale always uses the full range (no flicker — it moves smoothly).
// ---------------------------------------------------------------------------

const depthUniforms = {
  uNear: { value: 0.1 },
  uFar: { value: 20 },
}

const SKINNED_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying float vViewZ;
varying vec3 vNormalView;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  vNormalView = normalize(transformedNormal);
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vViewZ = -mvPosition.z;
}
`

/** Linear view-space depth, white = near, black = far (ControlNet style). */
export const depthMaterial = new THREE.ShaderMaterial({
  uniforms: depthUniforms,
  vertexShader: SKINNED_VERTEX,
  fragmentShader: /* glsl */ `
    uniform float uNear;
    uniform float uFar;
    varying float vViewZ;
    void main() {
      float d = clamp((vViewZ - uNear) / (uFar - uNear), 0.0, 1.0);
      gl_FragColor = vec4(vec3(1.0 - d), 1.0);
    }
  `,
})

/** View-space normals in rgb + linear depth in alpha — the outline pass source. */
const normalDepthMaterial = new THREE.ShaderMaterial({
  uniforms: depthUniforms,
  vertexShader: SKINNED_VERTEX,
  fragmentShader: /* glsl */ `
    uniform float uNear;
    uniform float uFar;
    varying float vViewZ;
    varying vec3 vNormalView;
    void main() {
      float d = clamp((vViewZ - uNear) / (uFar - uNear), 0.0, 1.0);
      gl_FragColor = vec4(normalize(vNormalView) * 0.5 + 0.5, d);
    }
  `,
})

export const normalsMaterial = new THREE.MeshNormalMaterial()

// ---------------------------------------------------------------------------
// Outline (comic/lineart): Sobel over the normal+depth buffer, black ink on white
// ---------------------------------------------------------------------------

const sobelMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tSrc: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uNormalThreshold: { value: 1.0 },
    uDepthThreshold: { value: 0.08 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSrc;
    uniform vec2 uTexel;
    uniform float uNormalThreshold;
    uniform float uDepthThreshold;
    varying vec2 vUv;

    void main() {
      vec4 s00 = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0));
      vec4 s10 = texture2D(tSrc, vUv + uTexel * vec2( 0.0, -1.0));
      vec4 s20 = texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0));
      vec4 s01 = texture2D(tSrc, vUv + uTexel * vec2(-1.0,  0.0));
      vec4 s11 = texture2D(tSrc, vUv);
      vec4 s21 = texture2D(tSrc, vUv + uTexel * vec2( 1.0,  0.0));
      vec4 s02 = texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0));
      vec4 s12 = texture2D(tSrc, vUv + uTexel * vec2( 0.0,  1.0));
      vec4 s22 = texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0));

      vec4 gx = -s00 - 2.0 * s01 - s02 + s20 + 2.0 * s21 + s22;
      vec4 gy = -s00 - 2.0 * s10 - s20 + s02 + 2.0 * s12 + s22;

      float edgeNormal = length(gx.rgb) + length(gy.rgb);
      float edgeDepth = abs(gx.a) + abs(gy.a);

      // grazing surfaces (e.g. the floor near the horizon) have a steep depth
      // gradient on every pixel — scale the tolerance with local depth so only
      // true discontinuities (silhouettes) ink, not slanted surfaces
      float depthTolerance = uDepthThreshold * (1.0 + s11.a * 14.0);

      float ink = max(step(uNormalThreshold, edgeNormal), step(depthTolerance, edgeDepth));
      gl_FragColor = vec4(vec3(1.0 - ink), 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
})

const quadScene = new THREE.Scene()
quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sobelMaterial))
const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

let outlineTarget: THREE.WebGLRenderTarget | null = null
const BLACK = new THREE.Color('#000000')

/**
 * Renders the scene through `camera` as black-on-white lineart into the given
 * canvas region (CSS px — three multiplies by the pixel ratio internally).
 */
export function renderOutline(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const dpr = gl.getPixelRatio()
  const dw = Math.max(2, Math.round(width * dpr))
  const dh = Math.max(2, Math.round(height * dpr))
  if (!outlineTarget) {
    outlineTarget = new THREE.WebGLRenderTarget(dw, dh, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
    })
  } else if (outlineTarget.width !== dw || outlineTarget.height !== dh) {
    outlineTarget.setSize(dw, dh)
  }

  const prevOverride = scene.overrideMaterial
  const prevBackground = scene.background
  const prevAutoClear = gl.autoClear
  scene.overrideMaterial = normalDepthMaterial
  scene.background = BLACK
  gl.autoClear = true
  gl.setRenderTarget(outlineTarget)
  gl.render(scene, camera)
  gl.setRenderTarget(null)
  scene.overrideMaterial = prevOverride
  scene.background = prevBackground

  sobelMaterial.uniforms.tSrc.value = outlineTarget.texture
  sobelMaterial.uniforms.uTexel.value.set(1 / dw, 1 / dh)
  gl.setViewport(x, y, width, height)
  gl.setScissor(x, y, width, height)
  gl.setScissorTest(true)
  gl.render(quadScene, quadCamera)
  gl.setScissorTest(false)
  gl.autoClear = prevAutoClear
}

/**
 * Render the scene through `camera` into a scissored region (x,y bottom-up CSS
 * px, matching gl.setViewport). Shared by the PiP and the multi-pane split.
 * The caller is responsible for restoring the full viewport afterwards.
 */
export function renderSceneRegion(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  x: number,
  y: number,
  width: number,
  height: number,
  outline: boolean,
) {
  if (outline) {
    renderOutline(gl, scene, camera, x, y, width, height)
    return
  }
  const prevAutoClear = gl.autoClear
  gl.autoClear = true
  gl.setScissorTest(true)
  gl.setViewport(x, y, width, height)
  gl.setScissor(x, y, width, height)
  gl.render(scene, camera)
  gl.setScissorTest(false)
  gl.autoClear = prevAutoClear
}

const boundsCenter = new THREE.Vector3()
const boundsSize = new THREE.Vector3()

/**
 * Applies the global view mode: sets scene.overrideMaterial for depth/normals
 * and keeps the depth window tracking the active camera. Outline is rendered
 * by CameraPreview (it needs its own offscreen pass).
 */
export function ViewModeController() {
  const scene = useThree((s) => s.scene)
  const viewMode = useEditorStore((s) => s.viewMode)

  useEffect(() => {
    scene.overrideMaterial =
      viewMode === 'depth' ? depthMaterial : viewMode === 'normals' ? normalsMaterial : null
    return () => {
      scene.overrideMaterial = null
    }
  }, [scene, viewMode])

  useFrame(({ camera }) => {
    if (useEditorStore.getState().viewMode === 'clay') return
    const box = sceneBounds()
    if (!box) return
    box.getCenter(boundsCenter)
    box.getSize(boundsSize)
    const radius = Math.max(boundsSize.length() / 2, 1)
    const dist = camera.position.distanceTo(boundsCenter)
    depthUniforms.uNear.value = Math.max(0.05, dist - radius * 1.6)
    depthUniforms.uFar.value = dist + radius * 1.6
  })

  return null
}
