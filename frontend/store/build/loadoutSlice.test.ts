import { beforeEach, describe, expect, it } from 'vitest'
import { classes, gameConfig, incarnationNodeInfo, items, skills } from '@data'
import { useBuild } from './index'
import type { EquippedItem } from '../../types'

function makeItem(baseId: string): EquippedItem {
  return {
    baseId,
    affixes: [],
    socketCount: 0,
    socketed: [],
    socketTypes: [],
  }
}

describe('allocation loadout banks', () => {
  beforeEach(() => {
    useBuild.getState().resetBuild()
  })

  it('starts each independent bank with only slot 1 occupied', () => {
    const state = useBuild.getState()
    for (const slots of [
      state.specLoadouts,
      state.incarnationLoadouts,
      state.etherLoadouts,
    ]) {
      expect(slots).toHaveLength(8)
      expect(slots[0]).not.toBeNull()
      expect(slots.slice(1)).toEqual(Array(7).fill(null))
    }
    expect(state.activeSpecLoadoutIndex).toBe(0)
    expect(state.activeIncarnationLoadoutIndex).toBe(0)
    expect(state.activeEtherLoadoutIndex).toBe(0)
  })

  it('creates the exact selected plus slot and restores a complete Spec', () => {
    const attribute = gameConfig.attributes[0]!.key
    useBuild.setState({
      allocated: { ...useBuild.getState().allocated, [attribute]: 17 },
      skillRanks: { frost_orb: 30 },
      subskillRanks: { 'frost_orb:shatter': 4 },
      activeSkillIds: ['frost_orb'],
      activeAuraId: 'ice_aura',
    })

    useBuild.getState().createSpecLoadout(4)

    let state = useBuild.getState()
    expect(state.activeSpecLoadoutIndex).toBe(4)
    expect(state.specLoadouts[4]).not.toBeNull()
    expect(state.specLoadouts[1]).toBeNull()
    expect(state.skillRanks).toEqual({})
    expect(state.allocated[attribute]).toBe(0)

    useBuild.setState({
      allocated: { ...state.allocated, [attribute]: 3 },
      skillRanks: { nova: 8 },
      subskillRanks: { 'nova:wide': 2 },
      activeSkillIds: ['nova'],
      activeAuraId: null,
    })
    useBuild.getState().switchSpecLoadout(0)

    state = useBuild.getState()
    expect(state.allocated[attribute]).toBe(17)
    expect(state.skillRanks).toEqual({ frost_orb: 30 })
    expect(state.subskillRanks).toEqual({ 'frost_orb:shatter': 4 })
    expect(state.activeSkillIds).toEqual(['frost_orb'])
    expect(state.activeAuraId).toBe('ice_aura')

    state.switchSpecLoadout(4)
    state = useBuild.getState()
    expect(state.allocated[attribute]).toBe(3)
    expect(state.skillRanks).toEqual({ nova: 8 })
    expect(state.subskillRanks).toEqual({ 'nova:wide': 2 })
    expect(state.activeSkillIds).toEqual(['nova'])
    expect(state.activeAuraId).toBeNull()
  })

  it('isolates Incarnation nodes and sockets without changing other banks', () => {
    useBuild.setState({
      allocatedTreeNodes: new Set([11, 12]),
      treeSocketed: { 12: { kind: 'item', id: 'jewel-a' } },
    })
    useBuild.getState().createIncarnationLoadout(2)

    expect(useBuild.getState().activeIncarnationLoadoutIndex).toBe(2)
    expect(useBuild.getState().allocatedTreeNodes.size).toBe(0)
    expect(useBuild.getState().treeSocketed).toEqual({})
    expect(useBuild.getState().activeSpecLoadoutIndex).toBe(0)
    expect(useBuild.getState().activeEtherLoadoutIndex).toBe(0)

    useBuild.setState({
      allocatedTreeNodes: new Set([99]),
      treeSocketed: {
        99: {
          kind: 'uncut',
          affixes: [{ affixId: 'cold', tier: 2, roll: 7 }],
        },
      },
    })
    useBuild.getState().switchIncarnationLoadout(0)

    expect([...useBuild.getState().allocatedTreeNodes]).toEqual([11, 12])
    expect(useBuild.getState().treeSocketed).toEqual({
      12: { kind: 'item', id: 'jewel-a' },
    })

    useBuild.getState().switchIncarnationLoadout(2)
    expect([...useBuild.getState().allocatedTreeNodes]).toEqual([99])
    expect(useBuild.getState().treeSocketed[99]).toEqual({
      kind: 'uncut',
      affixes: [{ affixId: 'cold', tier: 2, roll: 7 }],
    })
  })

  it('revalidates node-gated offhand gear when Incarnation changes', () => {
    const wand = items.find((item) => item.baseType === 'Wand')!
    const masterOfWands = Number(
      Object.entries(incarnationNodeInfo).find(
        ([, info]) => info.t === 'Master of Wands',
      )![0],
    )
    useBuild.setState({
      inventory: {
        weapon: makeItem(wand.id),
        offhand: makeItem(wand.id),
      },
      allocatedTreeNodes: new Set([masterOfWands]),
    })
    useBuild.getState().createIncarnationLoadout(1)

    expect(useBuild.getState().inventory.offhand).toBeUndefined()
    expect(useBuild.getState().inventory.weapon?.baseId).toBe(wand.id)
  })

  it('isolates Ether allocations and resets only the active slot', () => {
    useBuild.setState({ allocatedEtherNodes: new Set([1, 2]) })
    useBuild.getState().createEtherLoadout(1)
    useBuild.setState({ allocatedEtherNodes: new Set([8, 9]) })

    useBuild.getState().resetEtherNodes()
    expect(useBuild.getState().allocatedEtherNodes.size).toBe(0)

    useBuild.getState().switchEtherLoadout(0)
    expect([...useBuild.getState().allocatedEtherNodes]).toEqual([1, 2])

    useBuild.getState().switchEtherLoadout(1)
    expect(useBuild.getState().allocatedEtherNodes.size).toBe(0)
  })

  it('ignores invalid or already occupied creation targets', () => {
    const before = useBuild.getState().allocationLoadoutNavigationVersion
    useBuild.getState().createSpecLoadout(0)
    useBuild.getState().createSpecLoadout(8)
    useBuild.getState().createSpecLoadout(-1)

    const state = useBuild.getState()
    expect(state.activeSpecLoadoutIndex).toBe(0)
    expect(state.allocationLoadoutNavigationVersion).toBe(before)
    expect(state.specLoadouts.filter(Boolean)).toHaveLength(1)
  })

  it('migrates a legacy snapshot into slot 1 of every bank', () => {
    const skillId = skills[0]!.id
    const legacy = useBuild.getState().exportBuildSnapshot()
    legacy.skillRanks = { [skillId]: 2 }
    legacy.allocatedTreeNodes = new Set([101])
    legacy.allocatedEtherNodes = new Set([202])
    delete legacy.specLoadouts
    delete legacy.activeSpecLoadoutIndex
    delete legacy.incarnationLoadouts
    delete legacy.activeIncarnationLoadoutIndex
    delete legacy.etherLoadouts
    delete legacy.activeEtherLoadoutIndex

    useBuild.getState().importBuildSnapshot(legacy)

    const state = useBuild.getState()
    expect(state.specLoadouts).toHaveLength(8)
    expect(state.specLoadouts[0]?.skillRanks).toEqual({ [skillId]: 2 })
    expect(state.specLoadouts.slice(1)).toEqual(Array(7).fill(null))
    expect([...state.incarnationLoadouts[0]!.allocatedTreeNodes]).toEqual([
      101,
    ])
    expect([...state.etherLoadouts[0]!.allocatedEtherNodes]).toEqual([202])
  })

  it('clears every class-bound Spec and Incarnation socket on class change', () => {
    useBuild.setState({
      skillRanks: { first: 1 },
      treeSocketed: { 1: { kind: 'item', id: 'first-jewel' } },
    })
    useBuild.getState().createSpecLoadout(3)
    useBuild.getState().createIncarnationLoadout(2)
    useBuild.setState({
      skillRanks: { second: 2 },
      treeSocketed: { 2: { kind: 'item', id: 'second-jewel' } },
    })

    const otherClass = classes.find(
      (characterClass) => characterClass.id !== useBuild.getState().classId,
    )
    expect(otherClass).toBeDefined()
    useBuild.getState().setClass(otherClass!.id)

    const state = useBuild.getState()
    expect(state.skillRanks).toEqual({})
    expect(state.activeSpecLoadoutIndex).toBe(0)
    expect(state.specLoadouts.filter(Boolean)).toHaveLength(1)
    expect(state.treeSocketed).toEqual({})
    expect(
      state.incarnationLoadouts.every(
        (loadout) => loadout == null || Object.keys(loadout.treeSocketed).length === 0,
      ),
    ).toBe(true)
  })
})
