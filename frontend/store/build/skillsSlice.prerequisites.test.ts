import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StateCreator } from 'zustand/vanilla'
import type * as DataModule from '@data'
import type { Skill } from '../../types'
import type { BuildStore } from './types'

const prerequisiteSkills = vi.hoisted(
  () =>
    [
      {
        id: 'parent_a',
        classId: 'test_class',
        name: 'Parent A',
        kind: 'passive',
        maxRank: 20,
        ranks: [],
      },
      {
        id: 'parent_b',
        classId: 'test_class',
        name: 'Parent B',
        kind: 'passive',
        maxRank: 20,
        ranks: [],
      },
      {
        id: 'child',
        classId: 'test_class',
        name: 'Child',
        kind: 'passive',
        maxRank: 20,
        ranks: [],
        requiresAllOf: ['parent_a', 'parent_b'],
      },
      {
        id: 'grandchild',
        classId: 'test_class',
        name: 'Grandchild',
        kind: 'passive',
        maxRank: 20,
        ranks: [],
        requiresAllOf: ['child'],
      },
      {
        id: 'legacy_child',
        classId: 'test_class',
        name: 'Legacy Child',
        kind: 'passive',
        maxRank: 20,
        ranks: [],
        requiresSkill: 'parent_a',
      },
    ] satisfies Skill[],
)

vi.mock('@data', async (importOriginal) => ({
  ...(await importOriginal<typeof DataModule>()),
  skills: prerequisiteSkills,
}))

import { createSkillsSlice } from './skillsSlice'

type TestStore = Pick<
  BuildStore,
  | 'level'
  | 'skillRanks'
  | 'subskillRanks'
  | 'activeSkillIds'
  | 'activeAuraId'
  | 'procToggles'
  | 'activeBuffs'
  | 'skillProjectiles'
  | 'setSkillRank'
  | 'incSkillRank'
  | 'decSkillRank'
  | 'resetSkillRanks'
  | 'setSubskillRank'
  | 'incSubskillRank'
  | 'decSubskillRank'
  | 'resetSubskillsFor'
  | 'toggleActiveSkill'
  | 'setActiveAura'
  | 'setProcToggle'
  | 'setBuffActive'
  | 'setSkillProjectiles'
>

function makeStore() {
  return createStore<TestStore>()((set, get, api) => ({
    level: 100,
    ...(createSkillsSlice as unknown as StateCreator<TestStore>)(set, get, api),
  }))
}

describe('skill rank prerequisites', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  it('keeps a multi-parent skill locked until every prerequisite has a rank', () => {
    store.getState().setSkillRank('child', 1, 20)
    expect(store.getState().skillRanks.child).toBeUndefined()

    store.getState().setSkillRank('parent_a', 1, 20)
    store.getState().setSkillRank('child', 1, 20)
    expect(store.getState().skillRanks.child).toBeUndefined()

    store.getState().setSkillRank('parent_b', 1, 20)
    store.getState().setSkillRank('child', 1, 20)
    expect(store.getState().skillRanks.child).toBe(1)
  })

  it('clears the child and its descendants when any parent is removed', () => {
    store.getState().setSkillRank('parent_a', 1, 20)
    store.getState().setSkillRank('parent_b', 1, 20)
    store.getState().setSkillRank('child', 1, 20)
    store.getState().setSkillRank('grandchild', 1, 20)

    store.getState().setSkillRank('parent_a', 0, 20)

    expect(store.getState().skillRanks).toEqual({ parent_b: 1 })
  })

  it('keeps legacy requiresSkill as a sole prerequisite option', () => {
    store.getState().setSkillRank('legacy_child', 1, 20)
    expect(store.getState().skillRanks.legacy_child).toBeUndefined()

    store.getState().setSkillRank('parent_a', 1, 20)
    store.getState().setSkillRank('legacy_child', 1, 20)
    expect(store.getState().skillRanks.legacy_child).toBe(1)

    store.getState().setSkillRank('parent_a', 0, 20)

    expect(store.getState().skillRanks.legacy_child).toBeUndefined()
  })
})
