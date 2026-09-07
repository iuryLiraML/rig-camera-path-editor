export function uniquePathName(
  desired: string,
  taken: readonly { id: string; name: string }[],
  exceptId?: string,
): string {
  const base = desired.trim() || 'Path'
  const used = new Set(
    taken.filter((path) => path.id !== exceptId).map((path) => path.name.toLowerCase()),
  )
  if (!used.has(base.toLowerCase())) return base
  let n = 2
  while (used.has(`${base} ${n}`.toLowerCase())) n += 1
  return `${base} ${n}`
}
