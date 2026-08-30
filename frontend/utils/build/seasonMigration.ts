import { etherTree, gems, incarnationTree, items, runes, skills } from '@data'
import type {
  EquippedItem,
  EtherLoadout,
  IncarnationLoadout,
  Inventory,
  SlotKey,
  SpecLoadout,
  TreeSocketContent,
} from '../../types'
import {
  emptyEtherLoadout,
  emptyIncarnationLoadout,
} from './allocationLoadouts'
import type { BuildSnapshot } from './shareBuild'

export function clearSeasonBoundAllocations(snap: BuildSnapshot): BuildSnapshot {
  return {
    ...snap,
    heroLevel: 0,
    allocatedTreeNodes: new Set<number>(),
    allocatedEtherNodes: new Set<number>(),
    treeSocketed: {},
    incarnationLoadouts: snap.incarnationLoadouts?.map((loadout) =>
      loadout == null ? null : emptyIncarnationLoadout(),
    ),
    etherLoadouts: snap.etherLoadouts?.map((loadout) =>
      loadout == null ? null : emptyEtherLoadout(),
    ),
  }
}

const knownItemIds = new Set(items.map((i) => i.id))
const knownSkillIds = new Set(skills.map((s) => s.id))
const knownIncarnationNodeIds = new Set(incarnationTree.nodes.map((n) => n.id))
const knownEtherNodeIds = new Set(etherTree.nodes.map((n) => n.id))
const knownSubskillKeys = new Set(
  skills.flatMap((s) => (s.subskills ?? []).map((ss) => `${s.id}:${ss.id}`)),
)
const knownSocketableIds = new Set([
  ...gems.map((g) => g.id),
  ...runes.map((r) => r.id),
])

function pruneItem(item: EquippedItem): EquippedItem | null {
  if (!knownItemIds.has(item.baseId)) return null
  const socketed = item.socketed.map((id) =>
    id && knownSocketableIds.has(id) ? id : null,
  )
  return { ...item, socketed }
}

function pruneInventory(inventory: Inventory): Inventory {
  const out: Inventory = {}
  for (const [slot, item] of Object.entries(inventory)) {
    if (!item) continue
    const pruned = pruneItem(item)
    if (pruned) out[slot as SlotKey] = pruned
  }
  return out
}

function pruneRankMap(
  ranks: Record<string, number>,
  isKnown: (key: string) => boolean,
): Record<string, number> {
  return Object.fromEntries(Object.entries(ranks).filter(([k]) => isKnown(k)))
}

function pruneSpecLoadout(loadout: SpecLoadout): SpecLoadout {
  return {
    ...loadout,
    allocated: { ...loadout.allocated },
    skillRanks: pruneRankMap(loadout.skillRanks, (id) =>
      knownSkillIds.has(id),
    ),
    subskillRanks: pruneRankMap(loadout.subskillRanks, (key) =>
      knownSubskillKeys.has(key),
    ),
    activeSkillIds: loadout.activeSkillIds.filter((id) =>
      knownSkillIds.has(id),
    ),
    activeAuraId:
      loadout.activeAuraId && knownSkillIds.has(loadout.activeAuraId)
        ? loadout.activeAuraId
        : null,
  }
}

function pruneKnownNodes(
  nodes: ReadonlySet<number>,
  knownIds: ReadonlySet<number>,
): Set<number> {
  return new Set([...nodes].filter((id) => knownIds.has(id)))
}

function pruneTreeSockets(
  sockets: Record<number, TreeSocketContent | null>,
  allocated: ReadonlySet<number>,
): Record<number, TreeSocketContent | null> {
  return Object.fromEntries(
    Object.entries(sockets).filter(([nodeId]) =>
      allocated.has(Number(nodeId)),
    ),
  )
}

function pruneIncarnationLoadout(
  loadout: IncarnationLoadout,
): IncarnationLoadout {
  const allocatedTreeNodes = pruneKnownNodes(
    loadout.allocatedTreeNodes,
    knownIncarnationNodeIds,
  )
  return {
    allocatedTreeNodes,
    treeSocketed: pruneTreeSockets(loadout.treeSocketed, allocatedTreeNodes),
  }
}

function pruneEtherLoadout(loadout: EtherLoadout): EtherLoadout {
  return {
    allocatedEtherNodes: pruneKnownNodes(
      loadout.allocatedEtherNodes,
      knownEtherNodeIds,
    ),
  }
}

export function pruneUnknownAllocationIds(
  snap: BuildSnapshot,
): BuildSnapshot {
  const allocatedTreeNodes = pruneKnownNodes(
    snap.allocatedTreeNodes ?? new Set<number>(),
    knownIncarnationNodeIds,
  )
  const allocatedEtherNodes = pruneKnownNodes(
    snap.allocatedEtherNodes ?? new Set<number>(),
    knownEtherNodeIds,
  )
  return {
    ...snap,
    allocatedTreeNodes,
    treeSocketed: pruneTreeSockets(
      snap.treeSocketed ?? {},
      allocatedTreeNodes,
    ),
    allocatedEtherNodes,
    incarnationLoadouts: snap.incarnationLoadouts?.map((loadout) =>
      loadout == null ? null : pruneIncarnationLoadout(loadout),
    ),
    etherLoadouts: snap.etherLoadouts?.map((loadout) =>
      loadout == null ? null : pruneEtherLoadout(loadout),
    ),
  }
}

export function pruneUnknownIds(snap: BuildSnapshot): BuildSnapshot {
  const allocation = pruneUnknownAllocationIds(snap)
  return {
    ...allocation,
    inventory: pruneInventory(snap.inventory),
    mercInventory: pruneInventory(snap.mercInventory),
    skillRanks: pruneRankMap(snap.skillRanks, (id) => knownSkillIds.has(id)),
    subskillRanks: pruneRankMap(snap.subskillRanks, (key) =>
      knownSubskillKeys.has(key),
    ),
    activeSkillIds: snap.activeSkillIds.filter((id) => knownSkillIds.has(id)),
    activeAuraId:
      snap.activeAuraId && knownSkillIds.has(snap.activeAuraId)
        ? snap.activeAuraId
        : null,
    specLoadouts: snap.specLoadouts?.map((loadout) =>
      loadout == null ? null : pruneSpecLoadout(loadout),
    ),
  }
}
