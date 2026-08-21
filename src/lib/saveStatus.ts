import { create } from 'zustand'

/** Chip next to the project name — independent of `useProjectStore` so status writes do not retrigger autosave. */
export type SaveStatus = 'saved' | 'saving' | 'dirty'

interface SaveStatusState {
  status: SaveStatus
  setStatus: (status: SaveStatus) => void
}

export const useSaveStatusStore = create<SaveStatusState>((set) => ({
  status: 'saved',
  setStatus: (status) => set({ status }),
}))
