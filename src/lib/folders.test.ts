import { describe, expect, it } from 'vitest'
import { projectsInFolder, unfiledProjects } from './folders'

describe('folder grouping', () => {
  const projects = [
    { id: 'a', folderId: 'f1' },
    { id: 'b', folderId: null },
    { id: 'c', folderId: 'f1' },
    { id: 'd' },
  ]

  it('lists projects that belong to a folder', () => {
    expect(projectsInFolder(projects, 'f1').map((p) => p.id)).toEqual(['a', 'c'])
  })

  it('treats missing folderId as unfiled', () => {
    expect(unfiledProjects(projects).map((p) => p.id)).toEqual(['b', 'd'])
  })
})
