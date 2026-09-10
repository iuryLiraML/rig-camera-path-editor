import { create } from 'zustand'

/** Intake remains outside a project until the user confirms creation. */
export const useProjectCreationStore = create<{
  open: boolean
  folderId: string | null
  show: (folderId?: string | null) => void
  close: () => void
}>((set) => ({
  open: false,
  folderId: null,
  show: (folderId = null) => set({ open: true, folderId }),
  close: () => set({ open: false }),
}))
