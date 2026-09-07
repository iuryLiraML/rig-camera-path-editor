import { create } from 'zustand'

/** Chip next to the project name — independent of `useProjectStore` so status writes do not retrigger autosave. */
export type SaveStatus = 'saved' | 'saving' | 'dirty'

interface SaveStatusState {
  status: SaveStatus
  cloud: Record<string, 'pending' | 'syncing' | 'saved' | 'error'>
  setCloudStatus: (id: string, status: 'pending' | 'syncing' | 'saved' | 'error') => void
  setStatus: (status: SaveStatus) => void
}

export const useSaveStatusStore = create<SaveStatusState>((set) => ({
  status: 'saved',
  cloud: {},
  setCloudStatus: (id, status) => set((s) => ({ cloud: { ...s.cloud, [id]: status } })),
  setStatus: (status) => set({ status }),
}))
