function canonicalMercSkillRanks(ranks) {
  if (ranks === undefined) return undefined
  if (!ranks || typeof ranks !== 'object' || Array.isArray(ranks)) return {}
  return Object.fromEntries(
    Object.entries(ranks).filter(
      ([, rank]) => Number.isInteger(rank) && rank > 0,
    ),
  )
}

export function expectedSummary(patch) {
  const mercSkillRanks = canonicalMercSkillRanks(patch.mercSkillRanks)
  return {
    incarnation: Object.fromEntries(
      (patch.incarnationLoadouts ?? [])
        .map((entry) => [
          entry.index,
          Array.isArray(entry.nodes) ? [...new Set(entry.nodes)] : null,
        ]),
    ),
    ether: Object.fromEntries(
      (patch.etherLoadouts ?? [])
        .map((entry) => [
          entry.index,
          Array.isArray(entry.nodes) ? [...new Set(entry.nodes)] : null,
        ]),
    ),
    mercClassId: patch.mercClassId,
    mercSkillPoints: mercSkillRanks
      ? Object.values(mercSkillRanks).reduce((sum, rank) => sum + rank, 0)
      : undefined,
    mercSkillRanks,
    activeIncarnationLoadoutIndex: patch.activeIncarnationLoadoutIndex,
    activeEtherLoadoutIndex: patch.activeEtherLoadoutIndex,
  }
}

export function inventoryChanges(before = {}, after = {}) {
  const slots = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return slots.flatMap((slot) => {
    if (!(slot in after)) return [{ slot, change: 'removed' }]
    if (!(slot in before)) return [{ slot, change: 'added' }]
    if (JSON.stringify(before[slot]) !== JSON.stringify(after[slot])) {
      return [{ slot, change: 'changed' }]
    }
    return []
  })
}

export function verifySummary(result, expected, before, canonicalInventory) {
  if (result.buildCount !== before.buildCount) throw new Error('saved build count changed')
  if (result.name !== before.name || result.profileName !== before.profileName) {
    throw new Error('build/profile metadata changed')
  }
  if (result.season !== before.season) throw new Error('build season changed')
  if (
    !result.inventory ||
    typeof result.inventory !== 'object' ||
    Array.isArray(result.inventory) ||
    result.gearSlots !== Object.keys(result.inventory).length
  ) {
    throw new Error('gear slot summary is inconsistent')
  }
  if (
    canonicalInventory !== undefined &&
    JSON.stringify(result.inventory) !== JSON.stringify(canonicalInventory)
  ) {
    throw new Error('equipped gear changed after the applied patch response')
  }
  for (const [index, nodes] of Object.entries(expected.incarnation)) {
    const actual = result.incarnationNodes?.[Number(index)]
    if (nodes === null) {
      if (actual !== null) {
        throw new Error(`Incarnation slot ${Number(index) + 1} was not cleared`)
      }
      continue
    }
    if (
      !Array.isArray(actual) ||
      JSON.stringify([...actual].sort((a, b) => a - b)) !==
        JSON.stringify([...nodes].sort((a, b) => a - b))
    ) {
      throw new Error(`Incarnation slot ${Number(index) + 1} did not persist`)
    }
    const retained = Object.fromEntries(
      Object.entries(before.incarnationSockets?.[Number(index)] ?? {}).filter(
        ([nodeId]) => nodes.includes(Number(nodeId)),
      ),
    )
    if (
      JSON.stringify(result.incarnationSockets?.[Number(index)] ?? {}) !==
      JSON.stringify(retained)
    ) {
      throw new Error(`Incarnation slot ${Number(index) + 1} sockets changed`)
    }
  }
  for (const [index, nodes] of Object.entries(expected.ether)) {
    const actual = result.etherNodes?.[Number(index)]
    if (nodes === null) {
      if (actual !== null) {
        throw new Error(`Ether slot ${Number(index) + 1} was not cleared`)
      }
      continue
    }
    if (
      !Array.isArray(actual) ||
      JSON.stringify([...actual].sort((a, b) => a - b)) !==
        JSON.stringify([...nodes].sort((a, b) => a - b))
    ) {
      throw new Error(`Ether slot ${Number(index) + 1} did not persist`)
    }
  }
  if (
    expected.activeIncarnationLoadoutIndex !== undefined &&
    result.activeIncarnationLoadoutIndex !==
      expected.activeIncarnationLoadoutIndex
  ) {
    throw new Error('active Incarnation slot did not persist')
  }
  if (
    expected.activeEtherLoadoutIndex !== undefined &&
    result.activeEtherLoadoutIndex !== expected.activeEtherLoadoutIndex
  ) {
    throw new Error('active Ether slot did not persist')
  }
  if (
    expected.mercClassId !== undefined &&
    result.mercClassId !== expected.mercClassId
  ) {
    throw new Error('mercenary class did not persist')
  }
  if (
    expected.mercSkillPoints !== undefined &&
    result.mercSkillPoints !== expected.mercSkillPoints
  ) {
    throw new Error('mercenary skill ranks did not persist')
  }
  if (expected.mercSkillRanks) {
    const expectedEntries = Object.entries(expected.mercSkillRanks).sort()
    const actualEntries = Object.entries(result.mercSkillRanks ?? {}).sort()
    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      throw new Error('exact mercenary skill ranks did not persist')
    }
  }
}
