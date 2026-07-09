import { create } from 'zustand'
import type { RigSnapshot } from './useRigStore'
import type { ExportAspect, ExportRes } from './useEditorStore'

export interface ShotFormat {
  aspect: ExportAspect
  res: ExportRes
  custom: [number, number]
}

export interface Shot {
  id: string
  name: string
  order: number
  rig: RigSnapshot
  format: ShotFormat
  /** seconds, denormalized from rig.duration for the card */
  duration: number
  /** small JPEG preview captured when the shot was saved */
  thumbnail: Blob | null
}

export interface SavedPrompt {
  id: string
  title: string
  body: string
}

/** A user-authored camera-animation skill the agent can load and follow. */
export interface CustomSkill {
  id: string
  name: string
  description: string
  body: string
}

interface ProjectState {
  projectId: string
  name: string
  guidelines: string
  savedPrompts: SavedPrompt[]
  skills: CustomSkill[]
  shots: Shot[]
  /** all known projects, for the switcher */
  projectList: { id: string; name: string }[]

  setName: (name: string) => void
  setGuidelines: (text: string) => void
  addPrompt: (prompt: SavedPrompt) => void
  removePrompt: (id: string) => void
  upsertSkill: (skill: CustomSkill) => void
  removeSkill: (id: string) => void
  addShot: (shot: Shot) => void
  updateShot: (id: string, patch: Partial<Shot>) => void
  removeShot: (id: string) => void
  moveShot: (id: string, beforeId: string | null) => void
  setProjectList: (list: { id: string; name: string }[]) => void
  /** wholesale load when switching projects (persistence lives in lib/projects) */
  loadProject: (data: {
    projectId: string
    name: string
    guidelines: string
    savedPrompts: SavedPrompt[]
    skills: CustomSkill[]
    shots: Shot[]
  }) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectId: '',
  name: 'Untitled',
  guidelines: '',
  savedPrompts: [],
  skills: [],
  shots: [],
  projectList: [],

  setName: (name) => set({ name }),
  setGuidelines: (guidelines) => set({ guidelines }),

  addPrompt: (prompt) =>
    set((s) => ({ savedPrompts: [prompt, ...s.savedPrompts.filter((p) => p.body !== prompt.body)] })),

  removePrompt: (id) => set((s) => ({ savedPrompts: s.savedPrompts.filter((p) => p.id !== id) })),

  upsertSkill: (skill) =>
    set((s) => {
      const exists = s.skills.some((k) => k.id === skill.id)
      return {
        skills: exists ? s.skills.map((k) => (k.id === skill.id ? skill : k)) : [...s.skills, skill],
      }
    }),

  removeSkill: (id) => set((s) => ({ skills: s.skills.filter((k) => k.id !== id) })),

  addShot: (shot) => set((s) => ({ shots: [...s.shots, shot] })),

  updateShot: (id, patch) =>
    set((s) => ({ shots: s.shots.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)) })),

  removeShot: (id) => set((s) => ({ shots: s.shots.filter((sh) => sh.id !== id) })),

  moveShot: (id, beforeId) =>
    set((s) => {
      const ordered = [...s.shots].sort((a, b) => a.order - b.order)
      const moving = ordered.find((sh) => sh.id === id)
      if (!moving || id === beforeId) return s
      const rest = ordered.filter((sh) => sh.id !== id)
      const index = beforeId === null ? rest.length : rest.findIndex((sh) => sh.id === beforeId)
      if (index === -1) return s
      rest.splice(index, 0, moving)
      return { shots: rest.map((sh, i) => ({ ...sh, order: i })) }
    }),

  setProjectList: (projectList) => set({ projectList }),

  loadProject: (data) => set({ ...data }),
}))
