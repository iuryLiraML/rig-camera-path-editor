import { create } from 'zustand'
import type { CadFaceRef } from '../lib/primitiveGeometry'

/** Authoring selection is session-only and is never an animation channel. */
export const useSolidSelectionStore = create<{
  mode: 'body' | 'face' | 'edge'
  selection: { objectId: string; face?: CadFaceRef; edge?: number } | null
}>()(() => ({ mode: 'body', selection: null }))
