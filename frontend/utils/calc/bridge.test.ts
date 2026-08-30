import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Skill } from '../../types'
import {
  __depsToInputForTest,
  computeBuildPerformanceAsync,
  manaCostAtRankNative,
  optimizeGearNative,
  passiveStatsAtRankNative,
  setBridgeErrorListener,
  type BuildPerformanceOutput,
} from './bridge'
import { activeSeasonId } from '@data'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
const mockedListen = vi.mocked(listen)
const fakeSkill = { id: 'x', name: 'X' } as unknown as Skill

describe('bridge error notification', () => {
  const listener = vi.fn()

  beforeEach(() => {
    mockedInvoke.mockReset()
    listener.mockReset()
    setBridgeErrorListener(listener)
  })

  afterEach(() => {
    setBridgeErrorListener(null)
  })

  it('passiveStatsAtRankNative resolves with the invoke result', async () => {
    mockedInvoke.mockResolvedValue({ life: 10 })
    await expect(passiveStatsAtRankNative(fakeSkill, 3)).resolves.toEqual({
      life: 10,
    })
    expect(listener).not.toHaveBeenCalled()
  })

  it('passiveStatsAtRankNative notifies the listener and rejects on failure', async () => {
    mockedInvoke.mockRejectedValue('rust panic')
    await expect(passiveStatsAtRankNative(fakeSkill, 3)).rejects.toBeInstanceOf(
      Error,
    )
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]![0]).toBeInstanceOf(Error)
  })

  it('manaCostAtRankNative resolves with the invoke result', async () => {
    mockedInvoke.mockResolvedValue(42)
    await expect(manaCostAtRankNative(fakeSkill, 3)).resolves.toBe(42)
    expect(listener).not.toHaveBeenCalled()
  })

  it('manaCostAtRankNative notifies the listener and rejects on failure', async () => {
    mockedInvoke.mockRejectedValue(new Error('IPC fail'))
    await expect(manaCostAtRankNative(fakeSkill, 3)).rejects.toThrow('IPC fail')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

function baseDeps(season?: string) {
  return {
    classId: 'amazon',
    level: 1,
    allocatedAttrs: { strength: 0, dexterity: 0, intelligence: 0, energy: 0, vitality: 0, armor: 0 },
    inventory: {},
    skillRanks: {},
    subskillRanks: {},
    activeAuraId: null,
    activeBuffs: {},
    customStats: [],
    allocatedTreeNodes: new Set<number>(),
    treeSocketed: {},
    activeSkillIds: [],
    enemyConditions: {},
    playerConditions: {},
    skillProjectiles: {},
    enemyResistances: {},
    procToggles: {},
    killsPerSec: 1,
    ...(season ? { season } : {}),
  }
}

describe('depsToInput season', () => {
  it('uses the deps season when provided', () => {
    expect(__depsToInputForTest(baseDeps('s10')).season).toBe('s10')
  })
  it('falls back to the active season when deps season is absent', () => {
    expect(__depsToInputForTest(baseDeps()).season).toBe(activeSeasonId)
  })
})

describe('optimizeGearNative', () => {
  const unlisten = vi.fn()

  beforeEach(() => {
    mockedInvoke.mockReset()
    mockedListen.mockReset()
    unlisten.mockReset()
    mockedListen.mockResolvedValue(unlisten)
    setBridgeErrorListener(null)
  })

  it('forces the selected spell and cleans up its progress listener', async () => {
    mockedInvoke.mockResolvedValue({
      baseIds: { weapon: 'best' },
      beforeScore: 10,
      afterScore: 20,
      evaluated: 100,
      passes: 2,
      thresholdsMet: true,
      thresholdValues: { 'stat:life': 5000 },
      exact: false,
    })
    const progress = vi.fn()
    const promise = optimizeGearNative(
      { ...baseDeps('s10'), activeSkillIds: ['first', 'second'] },
      'second',
      {
        thresholds: { 'stat:life': 5000 },
        rarityFilter: { mode: 'at_least', rarity: 'satanic' },
        onProgress: progress,
      },
    )

    expect(mockedListen).toHaveBeenCalledWith(
      'gear-optimizer-progress',
      expect.any(Function),
    )
    await expect(promise).resolves.toMatchObject({ afterScore: 20 })
    expect(mockedInvoke).toHaveBeenCalledWith(
      'optimize_gear',
      expect.objectContaining({
        input: expect.objectContaining({
          selectedSkillId: 'second',
          perf: expect.objectContaining({
            mainSkillId: 'second',
            season: 's10',
          }),
          thresholds: { 'stat:life': 5000 },
          rarityFilter: { mode: 'at_least', rarity: 'satanic' },
        }),
      }),
    )
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('cleans up the listener when native optimization fails', async () => {
    mockedInvoke.mockRejectedValue(new Error('optimizer failed'))
    await expect(
      optimizeGearNative(baseDeps(), 'first', {
        thresholds: {},
        rarityFilter: null,
        onProgress: () => {},
      }),
    ).rejects.toThrow('optimizer failed')
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('rejects a concurrent optimization and releases the lock afterward', async () => {
    let resolveInvoke: (value: unknown) => void = () => {}
    mockedInvoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve
        }),
    )
    const first = optimizeGearNative(baseDeps(), 'first', {
      thresholds: {},
      rarityFilter: null,
    })

    await expect(
      optimizeGearNative(baseDeps(), 'second', {
        thresholds: {},
        rarityFilter: null,
      }),
    ).rejects.toThrow(/already running/i)
    expect(mockedInvoke).toHaveBeenCalledTimes(1)

    resolveInvoke({
      baseIds: {},
      beforeScore: 0,
      afterScore: 0,
      evaluated: 0,
      passes: 0,
      thresholdsMet: true,
      thresholdValues: {},
      exact: false,
    })
    await expect(first).resolves.toMatchObject({ thresholdsMet: true })
  })

  it('releases the run lock when progress listener setup fails', async () => {
    mockedListen.mockRejectedValueOnce(new Error('listener unavailable'))
    await expect(
      optimizeGearNative(baseDeps(), 'first', {
        thresholds: {},
        rarityFilter: null,
        onProgress: () => {},
      }),
    ).rejects.toThrow('listener unavailable')

    mockedInvoke.mockResolvedValue({
      baseIds: {},
      beforeScore: 0,
      afterScore: 0,
      evaluated: 0,
      passes: 0,
      thresholdsMet: true,
      thresholdValues: {},
      exact: false,
    })
    await expect(
      optimizeGearNative(baseDeps(), 'second', {
        thresholds: {},
        rarityFilter: null,
      }),
    ).resolves.toMatchObject({ thresholdsMet: true })
  })
})

function fakeOutput(o: Partial<BuildPerformanceOutput>): BuildPerformanceOutput {
  return {
    attributes: {},
    stats: {},
    damage: null,
    attackDamage: null,
    hitDpsMin: null,
    hitDpsMax: null,
    avgHitDpsMin: null,
    avgHitDpsMax: null,
    procDpsMin: 0,
    procDpsMax: 0,
    ailmentDpsMin: null,
    ailmentDpsMax: null,
    combinedDpsMin: null,
    combinedDpsMax: null,
    executeMult: 1,
    activeSkillName: null,
    statsCombined: {},
    itemSkillBonuses: {},
    rankBonuses: {},
    ...o,
  }
}

describe('computeBuildPerformanceAsync — combined (combo) DPS', () => {
  beforeEach(() => {
    mockedInvoke.mockReset()
    setBridgeErrorListener(null)
  })

  it('combines per-skill DPS into combinedDps (proc counted once); hit/avg stay primary', async () => {
    mockedInvoke.mockImplementation(async (_cmd, args) => {
      const id = (args as { input: { mainSkillId: string | null } }).input
        .mainSkillId
      if (id === 'a')
        return fakeOutput({
          hitDpsMin: 120,
          hitDpsMax: 120,
          avgHitDpsMin: 100,
          avgHitDpsMax: 100,
          procDpsMin: 5,
          procDpsMax: 5,
          combinedDpsMin: 105,
          combinedDpsMax: 105,
          activeSkillName: 'A',
        })
      return fakeOutput({
        hitDpsMin: 90,
        hitDpsMax: 90,
        avgHitDpsMin: 80,
        avgHitDpsMax: 80,
        procDpsMin: 5,
        procDpsMax: 5,
        combinedDpsMin: 85,
        combinedDpsMax: 85,
        activeSkillName: 'B',
      })
    })

    const perf = await computeBuildPerformanceAsync({
      ...baseDeps(),
      activeSkillIds: ['a', 'b'],
    })

    expect(mockedInvoke).toHaveBeenCalledTimes(2)
    expect(perf.combinedDpsMin).toBe(185)
    expect(perf.procDpsMin).toBe(5)
    expect(perf.hitDpsMin).toBe(120)
    expect(perf.avgHitDpsMin).toBe(100)
    expect(perf.activeSkillName).toBe('A + B')
    expect(perf.perSkill).toEqual([
      { id: 'a', name: 'A', hitDpsMin: 120, hitDpsMax: 120 },
      { id: 'b', name: 'B', hitDpsMin: 90, hitDpsMax: 90 },
    ])
  })

  it('keeps each skill execute multiplier when re-summing combined DPS', async () => {
    mockedInvoke.mockImplementation(async (_cmd, args) => {
      const id = (args as { input: { mainSkillId: string | null } }).input
        .mainSkillId
      if (id === 'a')
        return fakeOutput({
          avgHitDpsMin: 100,
          avgHitDpsMax: 100,
          ailmentDpsMin: 10,
          ailmentDpsMax: 10,
          procDpsMin: 5,
          procDpsMax: 5,
          executeMult: 2,
          combinedDpsMin: 230,
          combinedDpsMax: 230,
          activeSkillName: 'A',
        })
      return fakeOutput({
        avgHitDpsMin: 80,
        avgHitDpsMax: 80,
        procDpsMin: 5,
        procDpsMax: 5,
        executeMult: 1,
        combinedDpsMin: 85,
        combinedDpsMax: 85,
        activeSkillName: 'B',
      })
    })

    const perf = await computeBuildPerformanceAsync({
      ...baseDeps(),
      activeSkillIds: ['a', 'b'],
    })

    // a: (100 + 10) x 2 = 220, b: 80 x 1 = 80, proc 5 x 2 (primary) = 10
    expect(perf.combinedDpsMin).toBe(310)
    expect(perf.ailmentDpsMin).toBe(10)
  })

  it('a single active skill matches the legacy single-skill result', async () => {
    mockedInvoke.mockResolvedValue(
      fakeOutput({
        avgHitDpsMin: 100,
        avgHitDpsMax: 100,
        procDpsMin: 5,
        procDpsMax: 5,
        combinedDpsMin: 105,
        combinedDpsMax: 105,
        activeSkillName: 'A',
      }),
    )
    const perf = await computeBuildPerformanceAsync({
      ...baseDeps(),
      activeSkillIds: ['a'],
    })
    expect(mockedInvoke).toHaveBeenCalledTimes(1)
    expect(perf.combinedDpsMin).toBe(105)
  })

  it('no active skill reports proc-only combined DPS via a single call', async () => {
    mockedInvoke.mockResolvedValue(
      fakeOutput({
        procDpsMin: 7,
        procDpsMax: 7,
        combinedDpsMin: 7,
        combinedDpsMax: 7,
      }),
    )
    const perf = await computeBuildPerformanceAsync({
      ...baseDeps(),
      activeSkillIds: [],
    })
    expect(mockedInvoke).toHaveBeenCalledTimes(1)
    expect(perf.combinedDpsMin).toBe(7)
  })
})
