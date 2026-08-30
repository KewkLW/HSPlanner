import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBuild } from './index'
import {
  activeSeasonId,
  classes,
  etherTree,
  incarnationNodeInfo,
  incarnationTree,
  items,
} from '@data'
import {
  getActiveProfile,
  listSavedBuilds,
  loadProfileSnapshot,
} from '../../utils/build/savedBuilds'
import { encodeBuildToShare } from '../../utils/build/shareBuild'
import type { EquippedItem } from '../../types'

function makeItem(baseId: string): EquippedItem {
  return {
    baseId,
    affixes: [],
    socketCount: 0,
    socketed: [],
    socketTypes: [],
    stars: 0,
    forgedMods: [],
  }
}

function failingSetItem() {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota exceeded', 'QuotaExceededError')
  })
}

describe('build store — storage errors are surfaced, not swallowed', () => {
  beforeEach(() => {
    useBuild.setState({
      storageError: null,
      activeBuildId: null,
      activeProfileId: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useBuild.setState({
      storageError: null,
      activeBuildId: null,
      activeProfileId: null,
    })
  })

  it('records a storageError when a persisting action fails to write', () => {
    failingSetItem()
    expect(useBuild.getState().storageError).toBeNull()

    useBuild.getState().deleteSavedBuild('missing-build-id')

    expect(useBuild.getState().storageError).not.toBeNull()
  })

  it('saveCurrentAsNewBuild reports the failure and stays unbound when the write fails', () => {
    failingSetItem()

    const result = useBuild.getState().saveCurrentAsNewBuild('Quota Test')

    expect(result).toBeNull()
    expect(useBuild.getState().storageError).not.toBeNull()
    expect(useBuild.getState().activeBuildId).toBeNull()
  })

  it('saveCurrentAsNewBuild persists and binds the build when the write succeeds', () => {
    const result = useBuild.getState().saveCurrentAsNewBuild('Happy Path')

    expect(result).not.toBeNull()
    expect(useBuild.getState().storageError).toBeNull()
    expect(useBuild.getState().activeBuildId).not.toBeNull()
  })

  it('dismissStorageError clears a recorded error', () => {
    useBuild.setState({ storageError: 'something went wrong' })

    useBuild.getState().dismissStorageError()

    expect(useBuild.getState().storageError).toBeNull()
  })
})

describe('build store — commitEquippedItem', () => {
  beforeEach(() => {
    useBuild.setState({ inventory: {} })
  })

  it('sets the slot to the given item', () => {
    const base = items[0]
    useBuild.getState().commitEquippedItem('helm', makeItem(base.id))
    expect(useBuild.getState().inventory.helm?.baseId).toBe(base.id)
  })

  it('null unequips the slot', () => {
    const base = items[0]
    useBuild.setState({ inventory: { helm: makeItem(base.id) } })
    useBuild.getState().commitEquippedItem('helm', null)
    expect(useBuild.getState().inventory.helm).toBeUndefined()
  })

  it('committing a two-handed weapon clears the offhand', () => {
    const twoH = items.find((i) => i.twoHanded)
    const off = items.find((i) => i.slot === 'offhand' || i.baseType === 'shield')
    if (!twoH || !off) return
    useBuild.setState({ inventory: { offhand: makeItem(off.id) } })
    useBuild.getState().commitEquippedItem('weapon', makeItem(twoH.id))
    expect(useBuild.getState().inventory.offhand).toBeUndefined()
    expect(useBuild.getState().inventory.weapon?.baseId).toBe(twoH.id)
  })

  it('ignores an item with an unknown base', () => {
    useBuild.getState().commitEquippedItem('helm', makeItem('__nope__'))
    expect(useBuild.getState().inventory.helm).toBeUndefined()
  })
})

describe('build store — applyOptimizedGear', () => {
  const weaponA = items.find((i) => i.slot === 'weapon' && !i.twoHanded)!
  const weaponB = items.find(
    (i) => i.slot === 'weapon' && !i.twoHanded && i.id !== weaponA.id,
  )!
  const helmet = items.find((i) => i.slot === 'helmet')!
  const charm = items.find((i) => i.slot.startsWith('charm_'))!

  beforeEach(() => {
    useBuild.setState({ inventory: {}, allocatedTreeNodes: new Set() })
  })

  it('replaces regular gear with clean bases while preserving special slots', () => {
    const keptHelmet = {
      ...makeItem(helmet.id),
      affixes: [{ affixId: 'kept-roll', tier: 1, roll: 1 }],
    }
    const keptCharm = makeItem(charm.id)
    useBuild.setState({
      inventory: {
        weapon: makeItem(weaponA.id),
        helmet: keptHelmet,
        charm_1: keptCharm,
      },
    })

    useBuild.getState().applyOptimizedGear({
      weapon: weaponB.id,
      helmet: helmet.id,
    })

    const inventory = useBuild.getState().inventory
    expect(inventory.weapon?.baseId).toBe(weaponB.id)
    expect(inventory.weapon?.affixes).toEqual([])
    expect(inventory.helmet?.baseId).toBe(helmet.id)
    expect(inventory.helmet?.affixes).toEqual([])
    expect(inventory.helmet).not.toBe(keptHelmet)
    expect(inventory.charm_1).toBe(keptCharm)
  })

  it('drops regular slots omitted from the optimized result', () => {
    useBuild.setState({
      inventory: {
        weapon: makeItem(weaponA.id),
        helmet: makeItem(helmet.id),
      },
    })
    useBuild.getState().applyOptimizedGear({ weapon: weaponB.id })
    expect(useBuild.getState().inventory.helmet).toBeUndefined()
  })
})

describe('build store — dual wielding', () => {
  const wand = items.find((i) => i.baseType === 'Wand')!
  const sword = items.find((i) => i.baseType === 'Sword' && !i.twoHanded)!
  const twoHandedSword = items.find(
    (i) => i.baseType === 'Sword' && i.twoHanded,
  )!
  const masterOfWands = Number(
    Object.entries(incarnationNodeInfo).find(
      ([, info]) => info.t === 'Master of Wands',
    )![0],
  )

  beforeEach(() => {
    useBuild.setState({ inventory: {}, allocatedTreeNodes: new Set() })
  })

  it('keeps a second one-handed sword without any tree node', () => {
    useBuild.getState().commitEquippedItem('weapon', makeItem(sword.id))
    useBuild.getState().commitEquippedItem('offhand', makeItem(sword.id))
    expect(useBuild.getState().inventory.offhand?.baseId).toBe(sword.id)
  })

  it('drops the offhand weapon when a two-handed weapon goes in', () => {
    useBuild.getState().commitEquippedItem('weapon', makeItem(sword.id))
    useBuild.getState().commitEquippedItem('offhand', makeItem(sword.id))
    useBuild.getState().commitEquippedItem('weapon', makeItem(twoHandedSword.id))
    expect(useBuild.getState().inventory.offhand).toBeUndefined()
  })

  it('keeps a second wand while Master of Wands is allocated', () => {
    useBuild.setState({ allocatedTreeNodes: new Set([masterOfWands]) })
    useBuild.getState().commitEquippedItem('weapon', makeItem(wand.id))
    useBuild.getState().commitEquippedItem('offhand', makeItem(wand.id))
    expect(useBuild.getState().inventory.offhand?.baseId).toBe(wand.id)
  })

  it('drops the offhand wand when the node is deallocated', () => {
    useBuild.setState({ allocatedTreeNodes: new Set([masterOfWands]) })
    useBuild.getState().commitEquippedItem('weapon', makeItem(wand.id))
    useBuild.getState().commitEquippedItem('offhand', makeItem(wand.id))
    useBuild.getState().resetTreeNodes()
    expect(useBuild.getState().inventory.offhand).toBeUndefined()
  })
})

describe('build store — importCodeToLibrary', () => {
  beforeEach(() => {
    useBuild.setState({
      storageError: null,
      activeBuildId: null,
      activeProfileId: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useBuild.setState({ storageError: null })
  })

  it('saves a pasted code as a new Unfiled build without binding the planner', () => {
    const code = encodeBuildToShare(useBuild.getState().exportBuildSnapshot())
    const before = listSavedBuilds().length

    const rec = useBuild.getState().importCodeToLibrary(code)

    expect(rec).not.toBeNull()
    expect(rec!.folderId).toBeNull()
    expect(rec!.name).toMatch(/^Imported /)
    expect(listSavedBuilds().length).toBe(before + 1)
    expect(useBuild.getState().activeBuildId).toBeNull()
    expect(useBuild.getState().storageError).toBeNull()
  })

  it('stores a requested import name and preserves the validated source code', () => {
    const code = encodeBuildToShare(
      useBuild.getState().exportBuildSnapshot(),
      'source-code-only note',
      's10',
    )

    const rec = useBuild
      .getState()
      .importCodeToLibrary(code, 'Kewk - S10 Frost Orb Gear')

    expect(rec?.name).toBe('Kewk - S10 Frost Orb Gear')
    expect(getActiveProfile(rec!)?.code).toBe(code)
  })

  it('returns null for an unreadable code and adds nothing', () => {
    const before = listSavedBuilds().length

    const rec = useBuild.getState().importCodeToLibrary('not-a-build-code')

    expect(rec).toBeNull()
    expect(listSavedBuilds().length).toBe(before)
  })

  it('surfaces a storage error when the write fails', () => {
    const code = encodeBuildToShare(useBuild.getState().exportBuildSnapshot())
    failingSetItem()

    const rec = useBuild.getState().importCodeToLibrary(code)

    expect(rec).toBeNull()
    expect(useBuild.getState().storageError).not.toBeNull()
  })
})

describe('build store — patchSavedBuildProfile', () => {
  beforeEach(() => {
    localStorage.clear()
    useBuild.getState().resetBuild()
  })

  it('atomically patches the active profile and keeps top-level banks in sync', () => {
    useBuild.getState().setHeroLevel(1)
    const record = useBuild.getState().saveCurrentAsNewBuild('Patch target')!
    const incarnationId = incarnationTree.nodes[0]!.id
    const etherId = etherTree.nodes[0]!.id

    const result = useBuild.getState().patchSavedBuildProfile(
      record.id,
      record.activeProfileId,
      {
        incarnationLoadouts: [
          {
            index: 1,
            loadout: {
              allocatedTreeNodes: new Set([incarnationId]),
              treeSocketed: {},
            },
          },
        ],
        activeIncarnationLoadoutIndex: 1,
        etherLoadouts: [
          {
            index: 2,
            loadout: { allocatedEtherNodes: new Set([etherId]) },
          },
        ],
        activeEtherLoadoutIndex: 2,
        mercClassId: 'merc_magister',
        mercSkillRanks: { elemental_intellect: 8 },
      },
      activeSeasonId,
      getActiveProfile(record)!.updatedAt,
    )

    expect(result).toBe('applied')
    const live = useBuild.getState()
    expect(live.activeBuildId).toBe(record.id)
    expect(live.activeProfileId).toBe(record.activeProfileId)
    expect(live.allocatedTreeNodes).toEqual(new Set([incarnationId]))
    expect(live.incarnationLoadouts[1]?.allocatedTreeNodes).toEqual(
      new Set([incarnationId]),
    )
    expect(live.allocatedEtherNodes).toEqual(new Set([etherId]))
    expect(live.etherLoadouts[2]?.allocatedEtherNodes).toEqual(new Set([etherId]))
    expect(live.mercSkillRanks).toEqual({ elemental_intellect: 8 })

    const persisted = loadProfileSnapshot(record.id, record.activeProfileId)!
    expect(persisted.allocatedTreeNodes).toEqual(new Set([incarnationId]))
    expect(persisted.allocatedEtherNodes).toEqual(new Set([etherId]))
    expect(persisted.mercClassId).toBe('merc_magister')
  })

  it('rejects an Incarnation patch above the saved Hero-Level budget', () => {
    const roots = incarnationTree.nodes
      .filter((node) => node.t === 'root')
      .slice(0, 2)
      .map((node) => node.id)
    expect(roots).toHaveLength(2)
    useBuild.getState().setHeroLevel(1)
    const record = useBuild.getState().saveCurrentAsNewBuild('Capped patch')!

    const result = useBuild.getState().patchSavedBuildProfile(
      record.id,
      record.activeProfileId,
      {
        incarnationLoadouts: [
          {
            index: 0,
            loadout: {
              allocatedTreeNodes: new Set(roots),
              treeSocketed: {},
            },
          },
        ],
      },
      activeSeasonId,
      getActiveProfile(record)!.updatedAt,
    )

    expect(result).toBe('rejected')
    expect(useBuild.getState().heroLevel).toBe(1)
    expect(useBuild.getState().allocatedTreeNodes.size).toBe(0)
    expect(
      loadProfileSnapshot(record.id, record.activeProfileId)?.heroLevel,
    ).toBe(1)
  })

  it('rejects a patch that selects an empty loadout slot', () => {
    const record = useBuild.getState().saveCurrentAsNewBuild('Patch target')!

    expect(
      useBuild.getState().patchSavedBuildProfile(
        record.id,
        record.activeProfileId,
        { activeEtherLoadoutIndex: 3 },
        activeSeasonId,
        getActiveProfile(record)!.updatedAt,
      ),
    ).toBe('rejected')
    expect(useBuild.getState().activeEtherLoadoutIndex).toBe(0)
  })

  it('preserves sockets on retained Incarnation nodes', () => {
    const rootId = incarnationTree.nodes.find((node) => node.t === 'root')!.id
    useBuild.setState({
      heroLevel: 1,
      allocatedTreeNodes: new Set([rootId]),
      treeSocketed: { [rootId]: { kind: 'item', id: 'retained-jewel' } },
    })
    const record = useBuild.getState().saveCurrentAsNewBuild('Socket target')!

    expect(
      useBuild.getState().patchSavedBuildProfile(
        record.id,
        record.activeProfileId,
        {
          incarnationLoadouts: [
            {
              index: 0,
              loadout: {
                allocatedTreeNodes: new Set([rootId]),
                treeSocketed: {},
              },
            },
          ],
        },
        activeSeasonId,
        getActiveProfile(record)!.updatedAt,
      ),
    ).toBe('applied')
    expect(useBuild.getState().treeSocketed[rootId]).toEqual({
      kind: 'item',
      id: 'retained-jewel',
    })
  })

  it('revalidates offhand legality when the active Incarnation slot changes', () => {
    const wand = items.find((item) => item.baseType === 'Wand')!
    const masterOfWands = Number(
      Object.entries(incarnationNodeInfo).find(
        ([, info]) => info.t === 'Master of Wands',
      )![0],
    )
    useBuild.setState({
      heroLevel: 1,
      allocatedTreeNodes: new Set([masterOfWands]),
    })
    useBuild.getState().commitEquippedItem('weapon', makeItem(wand.id))
    useBuild.getState().commitEquippedItem('offhand', makeItem(wand.id))
    const record = useBuild.getState().saveCurrentAsNewBuild('Offhand target')!

    expect(
      useBuild.getState().patchSavedBuildProfile(
        record.id,
        record.activeProfileId,
        {
          incarnationLoadouts: [
            {
              index: 0,
              loadout: { allocatedTreeNodes: new Set(), treeSocketed: {} },
            },
          ],
        },
        activeSeasonId,
        getActiveProfile(record)!.updatedAt,
      ),
    ).toBe('applied')
    expect(useBuild.getState().inventory.offhand).toBeUndefined()
  })

  it('rejects a stale profile revision', () => {
    const record = useBuild.getState().saveCurrentAsNewBuild('CAS target')!
    expect(
      useBuild.getState().patchSavedBuildProfile(
        record.id,
        record.activeProfileId,
        { mercClassId: null, mercSkillRanks: {} },
        activeSeasonId,
        'stale-revision',
      ),
    ).toBe('conflict')
  })

  it('rejects an expected season mismatch as a retryable conflict', () => {
    const record = useBuild.getState().saveCurrentAsNewBuild('Season CAS target')!

    expect(
      useBuild.getState().patchSavedBuildProfile(
        record.id,
        record.activeProfileId,
        {
          mercClassId: 'merc_magister',
          mercSkillRanks: { elemental_intellect: 8 },
        },
        `${activeSeasonId}-stale`,
        getActiveProfile(record)!.updatedAt,
      ),
    ).toBe('conflict')
    expect(
      loadProfileSnapshot(record.id, record.activeProfileId)!.mercClassId,
    ).toBeNull()
  })
})

describe('build store — setClass keeps the saved-build binding', () => {
  beforeEach(() => {
    localStorage.clear()
    useBuild.getState().resetBuild()
  })

  it('changing class keeps the active build attached with notes and custom stats', () => {
    const record = useBuild.getState().saveCurrentAsNewBuild('Moja nazwa')!
    useBuild.getState().setNotes('hello')
    useBuild.getState().setCustomStats([{ statKey: 'life', value: '10' }])
    useBuild.getState().setSkillRank('some_skill', 3, 20)
    const other = classes.find((c) => c.id !== useBuild.getState().classId)!

    useBuild.getState().setClass(other.id)

    const s = useBuild.getState()
    expect(s.activeBuildId).toBe(record.id)
    expect(s.activeProfileId).toBe(record.activeProfileId)
    expect(s.notes).toBe('hello')
    expect(s.customStats).toHaveLength(1)
    expect(s.skillRanks).toEqual({})
  })
})
