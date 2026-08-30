import { describe, expect, it } from 'vitest'
import { etherTree, incarnationTree } from '@data'
import { parseLocalBuildPatch } from './localBuildPatch'

describe('parseLocalBuildPatch', () => {
  it('parses allow-listed loadouts and Magister ranks', () => {
    const incarnationId = incarnationTree.nodes.find((node) => node.t === 'root')!.id
    const etherId = etherTree.nodes.find((node) => node.t === 'root')!.id
    const patch = parseLocalBuildPatch({
      incarnationLoadouts: [{ index: 1, nodes: [incarnationId] }],
      activeIncarnationLoadoutIndex: 1,
      etherLoadouts: [{ index: 2, nodes: [etherId] }],
      activeEtherLoadoutIndex: 2,
      mercClassId: 'merc_magister',
      mercSkillRanks: { elemental_intellect: 8, tome_of_power: 20 },
    })

    expect(patch.incarnationLoadouts?.[0]?.loadout?.allocatedTreeNodes).toEqual(
      new Set([incarnationId]),
    )
    expect(patch.etherLoadouts?.[0]?.loadout?.allocatedEtherNodes).toEqual(
      new Set([etherId]),
    )
    expect(patch.mercSkillRanks).toEqual({
      elemental_intellect: 8,
      tome_of_power: 20,
    })
  })

  it('rejects unsupported fields and unknown nodes', () => {
    expect(() => parseLocalBuildPatch({ inventory: {} })).toThrow(
      'patch field inventory is not supported',
    )
    expect(() =>
      parseLocalBuildPatch({
        etherLoadouts: [{ index: 0, nodes: [999_999_999] }],
      }),
    ).toThrow('contains unknown node')
  })

  it('rejects known nodes that are disconnected from every root', () => {
    const incarnationId = incarnationTree.nodes.find((node) => node.t !== 'root')!.id
    const etherId = etherTree.nodes.find((node) => node.t !== 'root')!.id
    expect(() =>
      parseLocalBuildPatch({
        incarnationLoadouts: [{ index: 0, nodes: [incarnationId] }],
      }),
    ).toThrow('is not fully connected to a root')
    expect(() =>
      parseLocalBuildPatch({
        etherLoadouts: [{ index: 0, nodes: [etherId] }],
      }),
    ).toThrow('is not fully connected to a root')
  })

  it('rejects mercenary skills from another class and out-of-range ranks', () => {
    expect(() =>
      parseLocalBuildPatch({
        mercClassId: 'merc_magister',
        mercSkillRanks: { warriors_might: 1 },
      }),
    ).toThrow('is not a Magister skill')
    expect(() =>
      parseLocalBuildPatch({
        mercClassId: 'merc_magister',
        mercSkillRanks: { elemental_intellect: 21 },
      }),
    ).toThrow('rank must be an integer')
  })

  it('requires mercenary class and ranks to change together', () => {
    expect(() => parseLocalBuildPatch({ mercClassId: 'merc_magister' })).toThrow(
      'must be supplied together',
    )
    expect(() => parseLocalBuildPatch({ mercSkillRanks: {} })).toThrow(
      'must be supplied together',
    )
    expect(
      parseLocalBuildPatch({ mercClassId: null, mercSkillRanks: {} }),
    ).toEqual({ mercClassId: null, mercSkillRanks: {} })
  })

  it('canonicalizes explicit zero mercenary ranks by removing them', () => {
    expect(
      parseLocalBuildPatch({
        mercClassId: 'merc_magister',
        mercSkillRanks: { elemental_intellect: 0, tome_of_power: 20 },
      }),
    ).toMatchObject({
      mercClassId: 'merc_magister',
      mercSkillRanks: { tome_of_power: 20 },
    })
  })
})
