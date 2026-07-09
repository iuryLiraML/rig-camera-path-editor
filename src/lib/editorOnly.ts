import { useEffect, type RefObject } from 'react'
import type * as THREE from 'three'

/**
 * Registry of viewport helper objects (path lines, anchor gizmos, camera body…)
 * that must be hidden when rendering the cinema-camera preview.
 */
export const editorOnlySet = new Set<THREE.Object3D>()

export function useEditorOnly(ref: RefObject<THREE.Object3D | null>) {
  useEffect(() => {
    const obj = ref.current
    if (!obj) return
    editorOnlySet.add(obj)
    return () => {
      editorOnlySet.delete(obj)
    }
  })
}
