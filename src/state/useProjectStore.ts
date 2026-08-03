import { create } from 'zustand'
import {
  createProjectWorkflow,
  isProjectEditorReady,
  type ProjectWorkflow,
} from '../lib/projectWorkflow'
import type { RigSnapshot } from './useRigStore'
import type { ExportAspect, ExportRes } from './useEditorStore'

/**
 * What the Projects screen needs to draw a card. The list used to carry only
 * id/name/setupStatus, so every card was a title over dead space — no preview,
 * nothing to tell two projects apart and nothing to sort by.
 */
export interface ProjectSummary {
  id: string
  name: string
  setupStatus: 'draft' | 'ready'
  /** number of saved shots */
  shotCount: number
  /** last save (falls back to creation time for projects saved before this) */
  updatedAt: number
  /** first shot's still, used as the card preview */
  thumbnail?: Blob
}

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
  booted: boolean
  projectBusy: boolean
  projectId: string
  name: string
  workflow: ProjectWorkflow
  guidelines: string
  savedPrompts: SavedPrompt[]
  skills: CustomSkill[]
  shots: Shot[]
  /** all known projects, for the switcher and the Projects screen cards */
  projectList: ProjectSummary[]

  setBooted: (booted: boolean) => void
  setProjectBusy: (projectBusy: boolean) => void
  setName: (name: string) => void
  setWorkflow: (workflow: ProjectWorkflow) => void
  setGuidelines: (text: string) => void
  addPrompt: (prompt: SavedPrompt) => void
  removePrompt: (id: string) => void
  upsertSkill: (skill: CustomSkill) => void
  removeSkill: (id: string) => void
  addShot: (shot: Shot) => void
  updateShot: (id: string, patch: Partial<Shot>) => void
  removeShot: (id: string) => void
  moveShot: (id: string, beforeId: string | null) => void
  setProjectList: (list: ProjectSummary[]) => void
  /** wholesale load when switching projects (persistence lives in lib/projects) */
  loadProject: (data: {
    projectId: string
    name: string
    workflow: ProjectWorkflow
    guidelines: string
    savedPrompts: SavedPrompt[]
    skills: CustomSkill[]
    shots: Shot[]
  }) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  booted: false,
  projectBusy: false,
  projectId: '',
  name: 'Untitled',
  workflow: createProjectWorkflow('Untitled'),
  guidelines: '',
  savedPrompts: [],
  skills: [],
  shots: [],
  projectList: [],

  setBooted: (booted) => set({ booted }),
  setProjectBusy: (projectBusy) => set({ projectBusy }),
  setName: (name) =>
    set((state) => ({
      name,
      projectList: state.projectList.map((project) =>
        project.id === state.projectId ? { ...project, name } : project,
      ),
    })),
  setWorkflow: (workflow) =>
    set((state) => ({
      workflow,
      projectList: state.projectList.map((project) =>
        project.id === state.projectId
          ? {
              ...project,
              setupStatus: isProjectEditorReady(workflow) ? 'ready' : 'draft',
            }
          : project,
      ),
    })),
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
