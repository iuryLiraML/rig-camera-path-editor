import { idbDelete, idbGet, idbGetAll, idbPut, STORES } from './idb'
import { makeSceneId } from '../state/useSceneStore'

export type FolderRecord = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export function projectsInFolder<T extends { folderId?: string | null }>(
  projects: T[],
  folderId: string,
): T[] {
  return projects.filter((project) => project.folderId === folderId)
}

export function unfiledProjects<T extends { folderId?: string | null }>(projects: T[]): T[] {
  return projects.filter((project) => !project.folderId)
}

export async function listFolders(): Promise<FolderRecord[]> {
  const folders = await idbGetAll<FolderRecord>(STORES.folders)
  return [...folders].sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt)
}

export async function createFolder(name = 'Untitled folder'): Promise<FolderRecord> {
  const now = Date.now()
  const folder: FolderRecord = {
    id: makeSceneId('folder'),
    name: name.trim() || 'Untitled folder',
    createdAt: now,
    updatedAt: now,
  }
  await idbPut(STORES.folders, folder)
  return folder
}

export async function renameFolder(id: string, name: string): Promise<FolderRecord | null> {
  const existing = await idbGet<FolderRecord>(STORES.folders, id)
  if (!existing) return null
  const folder: FolderRecord = {
    ...existing,
    name: name.trim() || existing.name,
    updatedAt: Date.now(),
  }
  await idbPut(STORES.folders, folder)
  return folder
}

export async function deleteFolder(id: string): Promise<void> {
  await idbDelete(STORES.folders, id)
}
