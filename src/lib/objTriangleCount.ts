/** Counts triangulated OBJ faces without constructing a Three.js scene. */
export function countObjTriangles(buffer: ArrayBuffer): number | null {
  let text: string
  try {
    text = new TextDecoder().decode(buffer)
  } catch {
    return null
  }

  let triangles = 0
  let sawVertex = false
  let sawFace = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimStart()
    if (line.startsWith('v ') || line.startsWith('v\t')) {
      sawVertex = true
      continue
    }
    if (!line.startsWith('f ') && !line.startsWith('f\t')) continue
    const face = line.split('#', 1)[0].trim().split(/\s+/)
    if (face.length < 4) continue
    sawFace = true
    triangles += face.length - 3
  }
  return sawVertex && sawFace ? triangles : null
}
