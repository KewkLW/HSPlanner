export function rankPointOrder(
  ranks: Record<string, number>,
  requiresAllOf?: (id: string) => string | readonly string[] | undefined,
): string[] {
  const remaining = Object.keys(ranks)
  const result: string[] = []
  const taken = new Set<string>()

  const isEligible = (id: string): boolean => {
    if (!requiresAllOf) return true
    const prerequisiteIds = requiresAllOf(id)
    if (prerequisiteIds == null) return true
    const list = Array.isArray(prerequisiteIds)
      ? prerequisiteIds
      : [prerequisiteIds]
    return list.every((prerequisiteId) =>
      prerequisiteId in ranks ? taken.has(prerequisiteId) : true,
    )
  }

  while (remaining.length > 0) {
    const idx = remaining.findIndex(isEligible)
    if (idx < 0) break
    const [id] = remaining.splice(idx, 1)
    taken.add(id!)
    result.push(id!)
  }

  const order = [...result, ...remaining]
  const expanded: string[] = []
  for (const id of order) {
    const rank = ranks[id] ?? 0
    for (let i = 0; i < rank; i++) expanded.push(id)
  }
  return expanded
}
