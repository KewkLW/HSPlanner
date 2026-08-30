import { describe, expect, it } from 'vitest'
import { gems, items, skills } from '@data'
import type { EquippedItem } from '../../types'
import { START_IDS } from '../tree/treeGraph'
import { ETHER_START_IDS } from '../tree/etherGraph'
import { makeSnapshot } from './buildSnapshot.fixture'
import {
  clearSeasonBoundAllocations,
  pruneUnknownIds,
} from './seasonMigration'

const realItemId = items[0].id
const realSkillId = skills[0].id
const realGemId = gems[0].id
const skillWithSubtree = skills.find((s) => (s.subskills ?? []).length > 0)!
const realSubskillKey = `${skillWithSubtree.id}:${skillWithSubtree.subskills![0].id}`

function equipped(baseId: string, socketed: (string | null)[] = []): EquippedItem {
  return {
    baseId,
    affixes: [],
    socketCount: socketed.length,
    socketed,
    socketTypes: [],
  }
}

describe('clearSeasonBoundAllocations', () => {
  it('resets tree, ether and tree sockets but keeps gear and skills', () => {
    const snap = makeSnapshot({
      allocatedTreeNodes: new Set([1, 2]),
      allocatedEtherNodes: new Set([4]),
      treeSocketed: { 7: { kind: 'item', id: 'gem_x' } as never },
      inventory: { weapon: equipped(realItemId) },
      skillRanks: { [realSkillId]: 5 },
    })

    const out = clearSeasonBoundAllocations(snap)

    expect(out.allocatedTreeNodes.size).toBe(0)
    expect(out.allocatedEtherNodes.size).toBe(0)
    expect(out.heroLevel).toBe(0)
    expect(out.treeSocketed).toEqual({})
    expect(out.inventory.weapon?.baseId).toBe(realItemId)
    expect(out.skillRanks[realSkillId]).toBe(5)
  })

  it('does not mutate the original snapshot', () => {
    const snap = makeSnapshot({ allocatedTreeNodes: new Set([1]) })

    clearSeasonBoundAllocations(snap)

    expect(snap.allocatedTreeNodes.has(1)).toBe(true)
  })

  it('clears every occupied Incarnation and Ether loadout', () => {
    const snap = makeSnapshot({
      incarnationLoadouts: [
        {
          allocatedTreeNodes: new Set([1]),
          treeSocketed: { 1: { kind: 'item', id: 'jewel-a' } },
        },
        null,
        {
          allocatedTreeNodes: new Set([9]),
          treeSocketed: { 9: { kind: 'item', id: 'jewel-b' } },
        },
      ],
      activeIncarnationLoadoutIndex: 2,
      etherLoadouts: [
        { allocatedEtherNodes: new Set([4]) },
        null,
        { allocatedEtherNodes: new Set([8]) },
      ],
      activeEtherLoadoutIndex: 2,
    })

    const out = clearSeasonBoundAllocations(snap)

    expect(out.incarnationLoadouts?.[0]?.allocatedTreeNodes.size).toBe(0)
    expect(out.incarnationLoadouts?.[0]?.treeSocketed).toEqual({})
    expect(out.incarnationLoadouts?.[1]).toBeNull()
    expect(out.incarnationLoadouts?.[2]?.allocatedTreeNodes.size).toBe(0)
    expect(out.incarnationLoadouts?.[2]?.treeSocketed).toEqual({})
    expect(out.etherLoadouts?.[0]?.allocatedEtherNodes.size).toBe(0)
    expect(out.etherLoadouts?.[1]).toBeNull()
    expect(out.etherLoadouts?.[2]?.allocatedEtherNodes.size).toBe(0)
    expect(snap.incarnationLoadouts?.[2]?.allocatedTreeNodes.has(9)).toBe(true)
    expect(snap.etherLoadouts?.[2]?.allocatedEtherNodes.has(8)).toBe(true)
  })
})

describe('pruneUnknownIds', () => {
  it('drops gear whose base does not exist in the active season', () => {
    const snap = makeSnapshot({
      inventory: {
        weapon: equipped(realItemId),
        armor: equipped('item_from_another_season'),
      },
    })

    const out = pruneUnknownIds(snap)

    expect(out.inventory.weapon?.baseId).toBe(realItemId)
    expect(out.inventory.armor).toBeUndefined()
  })

  it('empties unknown socketables but keeps known ones', () => {
    const snap = makeSnapshot({
      inventory: { weapon: equipped(realItemId, [realGemId, 'gem_ghost', null]) },
    })

    const out = pruneUnknownIds(snap)

    expect(out.inventory.weapon?.socketed).toEqual([realGemId, null, null])
  })

  it('drops unknown skill ranks, subskills, active skills and aura', () => {
    const snap = makeSnapshot({
      skillRanks: { [realSkillId]: 3, ghost_skill: 9 },
      subskillRanks: {
        [realSubskillKey]: 1,
        [`${skillWithSubtree.id}:ghost_node`]: 2,
        'ghost_skill:sub_b': 2,
      },
      activeSkillIds: [realSkillId, 'ghost_skill'],
      activeAuraId: 'ghost_aura',
    })

    const out = pruneUnknownIds(snap)

    expect(out.skillRanks).toEqual({ [realSkillId]: 3 })
    expect(out.subskillRanks).toEqual({ [realSubskillKey]: 1 })
    expect(out.activeSkillIds).toEqual([realSkillId])
    expect(out.activeAuraId).toBeNull()
  })

  it('does not mutate the original snapshot', () => {
    const snap = makeSnapshot({
      inventory: { weapon: equipped('item_from_another_season') },
      skillRanks: { ghost_skill: 9 },
    })

    pruneUnknownIds(snap)

    expect(snap.inventory.weapon?.baseId).toBe('item_from_another_season')
    expect(snap.skillRanks.ghost_skill).toBe(9)
  })

  it('prunes unknown skills from every occupied Spec loadout', () => {
    const snap = makeSnapshot({
      specLoadouts: [
        {
          allocated: { strength: 10 },
          skillRanks: { [realSkillId]: 3, ghost_skill: 9 },
          subskillRanks: {
            [realSubskillKey]: 1,
            'ghost_skill:node': 2,
          },
          activeSkillIds: [realSkillId, 'ghost_skill'],
          activeAuraId: 'ghost_aura',
        },
        null,
      ],
      activeSpecLoadoutIndex: 0,
    })

    const out = pruneUnknownIds(snap)
    const loadout = out.specLoadouts?.[0]

    expect(loadout?.skillRanks).toEqual({ [realSkillId]: 3 })
    expect(loadout?.subskillRanks).toEqual({ [realSubskillKey]: 1 })
    expect(loadout?.activeSkillIds).toEqual([realSkillId])
    expect(loadout?.activeAuraId).toBeNull()
    expect(snap.specLoadouts?.[0]?.skillRanks.ghost_skill).toBe(9)
  })

  it('prunes unknown tree ids and sockets from active and banked loadouts', () => {
    const incarnationRoot = START_IDS[0]!
    const etherRoot = ETHER_START_IDS[0]!
    const ghostNode = Number.MAX_SAFE_INTEGER
    const snap = makeSnapshot({
      heroLevel: 53,
      allocatedTreeNodes: new Set([incarnationRoot, ghostNode]),
      treeSocketed: {
        [incarnationRoot]: { kind: 'item', id: 'known-socket' },
        [ghostNode]: { kind: 'item', id: 'ghost-socket' },
      },
      allocatedEtherNodes: new Set([etherRoot, ghostNode]),
      incarnationLoadouts: [
        {
          allocatedTreeNodes: new Set([incarnationRoot, ghostNode]),
          treeSocketed: {
            [incarnationRoot]: { kind: 'item', id: 'known-socket' },
            [ghostNode]: { kind: 'item', id: 'ghost-socket' },
          },
        },
      ],
      activeIncarnationLoadoutIndex: 0,
      etherLoadouts: [
        { allocatedEtherNodes: new Set([etherRoot, ghostNode]) },
      ],
      activeEtherLoadoutIndex: 0,
    })

    const out = pruneUnknownIds(snap)

    expect(out.allocatedTreeNodes).toEqual(new Set([incarnationRoot]))
    expect(out.treeSocketed).toEqual({
      [incarnationRoot]: { kind: 'item', id: 'known-socket' },
    })
    expect(out.allocatedEtherNodes).toEqual(new Set([etherRoot]))
    expect(out.incarnationLoadouts?.[0]?.allocatedTreeNodes).toEqual(
      new Set([incarnationRoot]),
    )
    expect(out.incarnationLoadouts?.[0]?.treeSocketed).toEqual({
      [incarnationRoot]: { kind: 'item', id: 'known-socket' },
    })
    expect(out.etherLoadouts?.[0]?.allocatedEtherNodes).toEqual(
      new Set([etherRoot]),
    )
    expect(snap.allocatedTreeNodes.has(ghostNode)).toBe(true)
  })
})
