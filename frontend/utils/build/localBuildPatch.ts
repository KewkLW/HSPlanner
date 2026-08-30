import { etherTree, getMercClass, incarnationTree, mercData } from '@data'
import type {
  EtherLoadout,
  IncarnationLoadout,
  IndexedLoadoutPatch,
  SavedBuildAllocationPatch,
} from '../../types'
import { ALLOCATION_LOADOUT_SLOT_COUNT } from '../../types'
import {
  ADJ,
  reachableFromAny,
  START_IDS,
  type NodeAdjacency,
} from '../tree/treeGraph'
import { ETHER_ADJ, ETHER_START_IDS } from '../tree/etherGraph'

const ALLOWED_PATCH_KEYS = new Set([
  'incarnationLoadouts',
  'activeIncarnationLoadoutIndex',
  'etherLoadouts',
  'activeEtherLoadoutIndex',
  'mercClassId',
  'mercSkillRanks',
])

const INCARNATION_NODE_IDS = new Set(incarnationTree.nodes.map((node) => node.id))
const ETHER_NODE_IDS = new Set(etherTree.nodes.map((node) => node.id))

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function slotIndex(value: unknown, label: string): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) >= ALLOCATION_LOADOUT_SLOT_COUNT
  ) {
    throw new Error(`${label} must be an integer from 0 to 7`)
  }
  return value as number
}

function nodeIds(
  value: unknown,
  knownIds: ReadonlySet<number>,
  label: string,
  starts: Iterable<number>,
  adjacency: NodeAdjacency,
): Set<number> {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  if (value.length > knownIds.size) throw new Error(`${label} has too many nodes`)
  const ids = new Set<number>()
  for (const rawId of value) {
    if (!Number.isInteger(rawId) || !knownIds.has(rawId as number)) {
      throw new Error(`${label} contains unknown node ${String(rawId)}`)
    }
    ids.add(rawId as number)
  }
  if (ids.size > 0 && reachableFromAny(starts, ids, adjacency).size !== ids.size) {
    throw new Error(`${label} is not fully connected to a root`)
  }
  return ids
}

function loadoutPatches<T>(
  value: unknown,
  label: string,
  knownIds: ReadonlySet<number>,
  starts: Iterable<number>,
  adjacency: NodeAdjacency,
  makeLoadout: (nodes: Set<number>) => T,
): IndexedLoadoutPatch<T>[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  if (value.length > ALLOCATION_LOADOUT_SLOT_COUNT) {
    throw new Error(`${label} has too many entries`)
  }
  const seen = new Set<number>()
  return value.map((rawEntry, entryIndex) => {
    const entry = record(rawEntry, `${label}[${entryIndex}]`)
    const keys = Object.keys(entry)
    if (keys.some((key) => key !== 'index' && key !== 'nodes')) {
      throw new Error(`${label}[${entryIndex}] contains an unsupported field`)
    }
    const index = slotIndex(entry.index, `${label}[${entryIndex}].index`)
    if (seen.has(index)) throw new Error(`${label} repeats slot ${index + 1}`)
    seen.add(index)
    if (entry.nodes === null) return { index, loadout: null }
    return {
      index,
      loadout: makeLoadout(
        nodeIds(
          entry.nodes,
          knownIds,
          `${label}[${entryIndex}].nodes`,
          starts,
          adjacency,
        ),
      ),
    }
  })
}

/** Parse the intentionally narrow, untrusted payload accepted by the local bridge. */
export function parseLocalBuildPatch(raw: unknown): SavedBuildAllocationPatch {
  const input = record(raw, 'patch')
  for (const key of Object.keys(input)) {
    if (!ALLOWED_PATCH_KEYS.has(key)) {
      throw new Error(`patch field ${key} is not supported`)
    }
  }

  const patch: SavedBuildAllocationPatch = {}
  if ('incarnationLoadouts' in input) {
    patch.incarnationLoadouts = loadoutPatches<IncarnationLoadout>(
      input.incarnationLoadouts,
      'incarnationLoadouts',
      INCARNATION_NODE_IDS,
      START_IDS,
      ADJ,
      (nodes) => ({ allocatedTreeNodes: nodes, treeSocketed: {} }),
    )
  }
  if ('activeIncarnationLoadoutIndex' in input) {
    patch.activeIncarnationLoadoutIndex = slotIndex(
      input.activeIncarnationLoadoutIndex,
      'activeIncarnationLoadoutIndex',
    )
  }
  if ('etherLoadouts' in input) {
    patch.etherLoadouts = loadoutPatches<EtherLoadout>(
      input.etherLoadouts,
      'etherLoadouts',
      ETHER_NODE_IDS,
      ETHER_START_IDS,
      ETHER_ADJ,
      (nodes) => ({ allocatedEtherNodes: nodes }),
    )
  }
  if ('activeEtherLoadoutIndex' in input) {
    patch.activeEtherLoadoutIndex = slotIndex(
      input.activeEtherLoadoutIndex,
      'activeEtherLoadoutIndex',
    )
  }

  const hasMercClass = 'mercClassId' in input
  const hasMercRanks = 'mercSkillRanks' in input
  if (hasMercClass !== hasMercRanks) {
    throw new Error('mercClassId and mercSkillRanks must be supplied together')
  }
  if (hasMercClass) {
    if (
      input.mercClassId !== null &&
      (typeof input.mercClassId !== 'string' || !getMercClass(input.mercClassId))
    ) {
      throw new Error('mercClassId is unknown')
    }
    patch.mercClassId = input.mercClassId as string | null
  }
  if (hasMercRanks) {
    const classId = patch.mercClassId
    const ranks = record(input.mercSkillRanks, 'mercSkillRanks')
    if (classId === null) {
      if (Object.keys(ranks).length > 0) {
        throw new Error('a cleared mercenary cannot retain skill ranks')
      }
      patch.mercSkillRanks = {}
      return patch
    }
    const mercClass = classId ? getMercClass(classId) : undefined
    if (!mercClass) throw new Error('mercClassId is unknown')
    const knownSkills = new Set(mercClass.skills.map((skill) => skill.id))
    if (Object.keys(ranks).length > knownSkills.size) {
      throw new Error('mercSkillRanks has too many entries')
    }
    patch.mercSkillRanks = {}
    for (const [skillId, rawRank] of Object.entries(ranks)) {
      if (!knownSkills.has(skillId)) {
        throw new Error(`${skillId} is not a ${mercClass.name} skill`)
      }
      if (
        !Number.isInteger(rawRank) ||
        (rawRank as number) < 0 ||
        (rawRank as number) > mercData.maxSkillRank
      ) {
        throw new Error(
          `${skillId} rank must be an integer from 0 to ${mercData.maxSkillRank}`,
        )
      }
      if ((rawRank as number) > 0) patch.mercSkillRanks[skillId] = rawRank as number
    }
  }

  if (Object.keys(patch).length === 0) throw new Error('patch is empty')
  return patch
}
