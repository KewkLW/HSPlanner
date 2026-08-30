import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string'
import { describe, expect, it } from 'vitest'
import { makeSnapshot as makeBaseSnapshot } from './buildSnapshot.fixture'
import {
  type BuildSnapshot,
  decodeShareToBuild,
  encodeBuildToShare,
  parseBuildCodeFromInput,
} from './shareBuild'
import {
  DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER,
  GEAR_OPTIMIZER_THRESHOLD_MAX,
  MAX_GEAR_OPTIMIZER_THRESHOLDS,
} from '../../types'
import { START_IDS } from '../tree/treeGraph'

function makeSnapshot(overrides: Partial<BuildSnapshot> = {}): BuildSnapshot {
  return makeBaseSnapshot({
    classId: 'stormweaver',
    level: 50,
    allocated: { strength: 10 },
    skillRanks: { fireball: 5 },
    allocatedTreeNodes: new Set([1, 2, 3]),
    activeSkillIds: ['fireball'],
    enemyResistances: {},
    ...overrides,
  })
}

describe('encode/decode round-trip', () => {
  it('round-trips a basic snapshot', () => {
    const snap = makeSnapshot()
    const code = encodeBuildToShare(snap)
    const decoded = decodeShareToBuild(code)
    expect(decoded).not.toBeNull()
    expect(decoded!.snapshot.classId).toBe('stormweaver')
    expect(decoded!.snapshot.level).toBe(50)
    expect(decoded!.snapshot.skillRanks.fireball).toBe(5)
    expect([...decoded!.snapshot.allocatedTreeNodes]).toEqual([1, 2, 3])
    expect(decoded!.snapshot.activeSkillIds).toEqual(['fireball'])
  })

  it('round-trips an explicit Hero Level independently of allocated nodes', () => {
    const snap = makeSnapshot({ heroLevel: 53 })

    const decoded = decodeShareToBuild(encodeBuildToShare(snap))

    expect(decoded?.snapshot.heroLevel).toBe(53)
    expect(decoded?.snapshot.allocatedTreeNodes.size).toBe(3)
  })

  it('round-trips disabledPotions through share', () => {
    const snap = makeSnapshot({ disabledPotions: { potion_1: true } })
    const decoded = decodeShareToBuild(encodeBuildToShare(snap))
    expect(decoded!.snapshot.disabledPotions).toEqual({ potion_1: true })
  })

  it('round-trips skill bonus overrides on an equipped item', () => {
    const snap = makeSnapshot({
      inventory: {
        amulet: {
          baseId: 'amulet_heroic_gryphon_s_claw',
          affixes: [],
          socketCount: 0,
          socketed: [],
          socketTypes: [],
          skillBonusOverrides: { Execute: 15 },
        },
      },
    })
    const decoded = decodeShareToBuild(encodeBuildToShare(snap))
    expect(decoded!.snapshot.inventory.amulet?.skillBonusOverrides).toEqual({
      Execute: 15,
    })
  })

  it('round-trips a picked random skill on an equipped item', () => {
    const snap = makeSnapshot({
      inventory: {
        charm_1: {
          baseId: 'charm_satanic_engineer_s_mini_drone',
          affixes: [],
          socketCount: 0,
          socketed: [],
          socketTypes: [],
          randomSkillId: 'gunner_drone',
        },
      },
    })
    const decoded = decodeShareToBuild(encodeBuildToShare(snap))
    expect(decoded!.snapshot.inventory.charm_1?.randomSkillId).toBe('gunner_drone')
  })

  it('round-trips the picked random skill element', () => {
    const snap = makeSnapshot({
      inventory: {
        boots: {
          baseId: 's10_phantoms_step',
          affixes: [],
          socketCount: 0,
          socketed: [],
          socketTypes: [],
          randomSkillElement: 'cold',
        },
      },
    })
    const decoded = decodeShareToBuild(encodeBuildToShare(snap))
    expect(decoded!.snapshot.inventory.boots?.randomSkillElement).toBe('cold')
  })

  it('defaults disabledPotions to empty when absent from the payload', () => {
    const decoded = decodeShareToBuild(encodeBuildToShare(makeSnapshot()))
    expect(decoded!.snapshot.disabledPotions).toEqual({})
  })

  it('round-trips gear optimizer thresholds and rarity filter', () => {
    const snap = makeSnapshot({
      gearOptimizerThresholds: {
        'attribute:intelligence': 400,
        'stat:cold_resistance': 75,
      },
      gearOptimizerRarityFilter: {
        mode: 'at_least',
        rarity: 'heroic',
      },
    })

    const decoded = decodeShareToBuild(encodeBuildToShare(snap))

    expect(decoded!.snapshot.gearOptimizerThresholds).toEqual({
      'attribute:intelligence': 400,
      'stat:cold_resistance': 75,
    })
    expect(decoded!.snapshot.gearOptimizerRarityFilter).toEqual({
      mode: 'at_least',
      rarity: 'heroic',
    })
  })

  it('preserves a non-default rarity selection while filtering is off', () => {
    const snap = makeSnapshot({
      gearOptimizerRarityFilter: { mode: 'any', rarity: 'unholy' },
    })

    const decoded = decodeShareToBuild(encodeBuildToShare(snap))

    expect(decoded!.snapshot.gearOptimizerRarityFilter).toEqual({
      mode: 'any',
      rarity: 'unholy',
    })
  })

  it('defaults absent gear optimizer constraints', () => {
    const decoded = decodeShareToBuild(encodeBuildToShare(makeSnapshot()))
    expect(decoded!.snapshot.gearOptimizerThresholds).toEqual({})
    expect(decoded!.snapshot.gearOptimizerRarityFilter).toEqual(
      DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER,
    )
  })

  it('sanitizes unsupported and out-of-range optimizer thresholds on decode', () => {
    const payload = JSON.parse(
      decompressFromEncodedURIComponent(encodeBuildToShare(makeSnapshot()))!,
    ) as Record<string, unknown>
    payload.gt = {
      'stat:life': 1_000,
      'stat:invisible': 50,
      'stat:mana': GEAR_OPTIMIZER_THRESHOLD_MAX + 1,
      'attribute:strength': 'not-a-number',
    }
    const code = compressToEncodedURIComponent(JSON.stringify(payload))

    expect(decodeShareToBuild(code)?.snapshot.gearOptimizerThresholds).toEqual({
      'stat:life': 1_000,
    })
  })

  it('rejects an optimizer threshold record larger than the supported set', () => {
    const payload = JSON.parse(
      decompressFromEncodedURIComponent(encodeBuildToShare(makeSnapshot()))!,
    ) as Record<string, unknown>
    payload.gt = Object.fromEntries(
      Array.from({ length: MAX_GEAR_OPTIMIZER_THRESHOLDS + 1 }, (_, index) => [
        `stat:unknown_${index}`,
        index,
      ]),
    )
    const code = compressToEncodedURIComponent(JSON.stringify(payload))

    expect(decodeShareToBuild(code)).toBeNull()
  })

  it('migrates a legacy single-skill `m` string to activeSkillIds', () => {
    const code = compressToEncodedURIComponent(
      JSON.stringify({
        v: 1,
        c: 'stormweaver',
        l: 10,
        a: {},
        i: {},
        s: {},
        ss: {},
        t: [],
        m: 'fireball',
        u: null,
        buf: {},
        ec: {},
        pt: {},
        kps: 1,
      }),
    )
    const decoded = decodeShareToBuild(code)
    expect(decoded).not.toBeNull()
    expect(decoded!.snapshot.activeSkillIds).toEqual(['fireball'])
  })

  it('preserves and sanitizes notes through the round-trip', () => {
    const snap = makeSnapshot()
    const code = encodeBuildToShare(snap, '<p>safe<script>alert(1)</script></p>')
    const decoded = decodeShareToBuild(code)
    expect(decoded).not.toBeNull()
    expect(decoded!.notes).not.toContain('<script')
    expect(decoded!.notes).not.toContain('alert(1)')
    expect(decoded!.notes).toContain('safe')
  })
})

describe('allocation loadout banks', () => {
  it('round-trips sparse spec, incarnation, and ether banks with active slots', () => {
    const snap = makeSnapshot({
      specLoadouts: [
        {
          allocated: { strength: 10 },
          skillRanks: { fireball: 5 },
          subskillRanks: { 'fireball:burn': 2 },
          activeSkillIds: ['fireball'],
          activeAuraId: 'flame_aura',
        },
        null,
        {
          allocated: { intelligence: 24 },
          skillRanks: { frost_orb: 30 },
          subskillRanks: { 'frost_orb:shatter': 4 },
          activeSkillIds: ['frost_orb', 'ice_nova'],
          activeAuraId: null,
        },
      ],
      activeSpecLoadoutIndex: 2,
      incarnationLoadouts: [
        {
          allocatedTreeNodes: new Set([1, 3]),
          treeSocketed: {
            3: { kind: 'item', id: 'rune_frost' },
          },
        },
        null,
        {
          allocatedTreeNodes: new Set([18, 21]),
          treeSocketed: {
            21: {
              kind: 'uncut',
              affixes: [{ affixId: 'cold_damage', tier: 2, roll: 7 }],
            },
          },
        },
      ],
      activeIncarnationLoadoutIndex: 2,
      etherLoadouts: [
        { allocatedEtherNodes: new Set([7]) },
        null,
        { allocatedEtherNodes: new Set([31, 44]) },
      ],
      activeEtherLoadoutIndex: 2,
    })

    const decoded = decodeShareToBuild(encodeBuildToShare(snap))

    expect(decoded).not.toBeNull()
    expect(decoded!.snapshot.activeSpecLoadoutIndex).toBe(2)
    expect(decoded!.snapshot.specLoadouts).toEqual([
      {
        allocated: { strength: 10 },
        skillRanks: { fireball: 5 },
        subskillRanks: { 'fireball:burn': 2 },
        activeSkillIds: ['fireball'],
        activeAuraId: 'flame_aura',
      },
      null,
      {
        allocated: { intelligence: 24 },
        skillRanks: { frost_orb: 30 },
        subskillRanks: { 'frost_orb:shatter': 4 },
        activeSkillIds: ['frost_orb', 'ice_nova'],
        activeAuraId: null,
      },
    ])
    expect(decoded!.snapshot.activeIncarnationLoadoutIndex).toBe(2)
    expect(decoded!.snapshot.incarnationLoadouts?.[1]).toBeNull()
    expect([
      ...decoded!.snapshot.incarnationLoadouts![2]!.allocatedTreeNodes,
    ]).toEqual([18, 21])
    expect(decoded!.snapshot.incarnationLoadouts![2]!.treeSocketed).toEqual({
      21: {
        kind: 'uncut',
        affixes: [{ affixId: 'cold_damage', tier: 2, roll: 7 }],
      },
    })
    expect(decoded!.snapshot.activeEtherLoadoutIndex).toBe(2)
    expect(decoded!.snapshot.etherLoadouts?.[1]).toBeNull()
    expect([
      ...decoded!.snapshot.etherLoadouts![2]!.allocatedEtherNodes,
    ]).toEqual([31, 44])
  })

  it('keeps legacy shares without an allocation-bank payload compatible', () => {
    const decoded = decodeShareToBuild(encodeBuildToShare(makeSnapshot()))

    expect(decoded).not.toBeNull()
    expect(decoded!.snapshot.specLoadouts).toBeUndefined()
    expect(decoded!.snapshot.incarnationLoadouts).toBeUndefined()
    expect(decoded!.snapshot.etherLoadouts).toBeUndefined()
  })

  it('infers a missing legacy Hero Level from the largest saved loadout', () => {
    const roots = START_IDS.slice(0, 4)
    expect(roots).toHaveLength(4)
    const code = encodeBuildToShare(
      makeSnapshot({
        heroLevel: undefined,
        allocatedTreeNodes: new Set([roots[0]!]),
      }),
    )
    const payload = JSON.parse(
      decompressFromEncodedURIComponent(code)!,
    ) as Record<string, unknown>
    delete payload.h
    payload.lo = {
      s: [{ a: {}, s: {}, ss: {}, m: [], u: null }],
      si: 0,
      i: [{ t: [roots[0]] }, null, { t: roots }],
      ii: 0,
      e: [{ t: [] }],
      ei: 0,
    }

    const decoded = decodeShareToBuild(
      compressToEncodedURIComponent(JSON.stringify(payload)),
    )

    expect(decoded?.snapshot.heroLevel).toBe(4)
  })

  it('does not let unknown legacy tree ids inflate inferred Hero Level', () => {
    const code = encodeBuildToShare(makeSnapshot({ allocatedTreeNodes: new Set() }))
    const payload = JSON.parse(
      decompressFromEncodedURIComponent(code)!,
    ) as Record<string, unknown>
    delete payload.h
    payload.t = [Number.MAX_SAFE_INTEGER]

    const decoded = decodeShareToBuild(
      compressToEncodedURIComponent(JSON.stringify(payload)),
    )

    expect(decoded?.snapshot.heroLevel).toBe(0)
    expect(decoded?.snapshot.allocatedTreeNodes.size).toBe(0)
    expect(() => encodeBuildToShare(decoded!.snapshot)).not.toThrow()
  })

  it('rejects an explicit Hero Level below its Incarnation allocation', () => {
    const roots = START_IDS.slice(0, 2)
    expect(roots).toHaveLength(2)
    const code = encodeBuildToShare(
      makeSnapshot({ heroLevel: 2, allocatedTreeNodes: new Set(roots) }),
    )
    const payload = JSON.parse(
      decompressFromEncodedURIComponent(code)!,
    ) as Record<string, unknown>
    payload.h = 1

    expect(
      decodeShareToBuild(
        compressToEncodedURIComponent(JSON.stringify(payload)),
      ),
    ).toBeNull()
  })

  it('rejects an oversized allocation bank', () => {
    const payload = JSON.parse(
      decompressFromEncodedURIComponent(encodeBuildToShare(makeSnapshot()))!,
    ) as Record<string, unknown>
    payload.lo = {
      s: Array.from({ length: 9 }, () => null),
      si: 0,
      i: [null],
      ii: 0,
      e: [null],
      ei: 0,
    }

    expect(
      decodeShareToBuild(
        compressToEncodedURIComponent(JSON.stringify(payload)),
      ),
    ).toBeNull()
  })
})

describe('decodeShareToBuild — invalid input', () => {
  it('returns null for empty string', () => {
    expect(decodeShareToBuild('')).toBeNull()
  })

  it('returns null for non-base64 garbage', () => {
    expect(decodeShareToBuild('!!!@@@###')).toBeNull()
  })

  it('returns null for valid lz-string but invalid JSON', () => {
    const code = compressToEncodedURIComponent('not json {[')
    expect(decodeShareToBuild(code)).toBeNull()
  })

  it('returns null for JSON missing required fields', () => {
    const code = compressToEncodedURIComponent(JSON.stringify({ v: 1 }))
    expect(decodeShareToBuild(code)).toBeNull()
  })

  it('returns null for wrong-shaped fields', () => {
    const code = compressToEncodedURIComponent(
      JSON.stringify({
        v: 1,
        c: 'x',
        l: 'fifty',
        a: {},
        i: {},
        s: {},
        ss: {},
        t: [],
        m: null,
        u: null,
        buf: {},
        ec: {},
        pt: {},
        kps: 1,
      }),
    )
    expect(decodeShareToBuild(code)).toBeNull()
  })

  it('rejects payloads with too many tree nodes', () => {
    const huge = Array.from({ length: 50_000 }, (_, i) => i)
    const code = compressToEncodedURIComponent(
      JSON.stringify({
        v: 1,
        c: 'x',
        l: 1,
        a: {},
        i: {},
        s: {},
        ss: {},
        t: huge,
        m: null,
        u: null,
        buf: {},
        ec: {},
        pt: {},
        kps: 1,
      }),
    )
    expect(decodeShareToBuild(code)).toBeNull()
  })

  it('rejects oversized input strings', () => {
    const oversized = 'A'.repeat(300_000)
    expect(decodeShareToBuild(oversized)).toBeNull()
  })

  it('clamps absurd levels into a sane range', () => {
    const snap = makeSnapshot({ level: 999_999_999 })
    const code = encodeBuildToShare(snap)
    const decoded = decodeShareToBuild(code)
    expect(decoded).not.toBeNull()
    expect(decoded!.snapshot.level).toBeLessThanOrEqual(10_000)
    expect(decoded!.snapshot.level).toBeGreaterThanOrEqual(1)
  })

  it('rejects non-finite numbers in records', () => {
    const code = compressToEncodedURIComponent(
      JSON.stringify({
        v: 1,
        c: 'x',
        l: 1,
        a: { strength: Number.NaN },
        i: {},
        s: {},
        ss: {},
        t: [],
        m: null,
        u: null,
        buf: {},
        ec: {},
        pt: {},
        kps: 1,
      }),
    )
    expect(decodeShareToBuild(code)).toBeNull()
  })

  it('rejects mismatched schema version', () => {
    const json = JSON.stringify({
      v: 999,
      c: null,
      l: 1,
      a: {},
      i: {},
      s: {},
      ss: {},
      t: [],
      m: null,
      u: null,
      buf: {},
      ec: {},
      pt: {},
      kps: 1,
    })
    const badCode = compressToEncodedURIComponent(json)
    expect(decodeShareToBuild(badCode)).toBeNull()
  })
})

describe('ether + merc fields', () => {
  it('round-trips ether nodes and merc state', () => {
    const snap = makeSnapshot({
      allocatedEtherNodes: new Set([19, 38, 44]),
      mercClassId: 'merc_knight',
      mercSkillRanks: { taunt: 5, defenses: 3 },
      mercInventory: {
        helmet: {
          baseId: 'helmet_common_cap',
          affixes: [],
          socketCount: 0,
          socketed: [],
          socketTypes: [],
          stars: 0,
          forgedMods: [],
        },
      },
    })
    const decoded = decodeShareToBuild(encodeBuildToShare(snap))
    expect(decoded).not.toBeNull()
    expect([...decoded!.snapshot.allocatedEtherNodes].sort((a, b) => a - b)).toEqual([
      19, 38, 44,
    ])
    expect(decoded!.snapshot.mercClassId).toBe('merc_knight')
    expect(decoded!.snapshot.mercSkillRanks).toEqual({ taunt: 5, defenses: 3 })
    expect(decoded!.snapshot.mercInventory.helmet?.baseId).toBe(
      'helmet_common_cap',
    )
  })

  it('defaults ether and merc state when absent from the payload', () => {
    const decoded = decodeShareToBuild(encodeBuildToShare(makeSnapshot()))
    expect(decoded!.snapshot.allocatedEtherNodes.size).toBe(0)
    expect(decoded!.snapshot.mercClassId).toBeNull()
    expect(decoded!.snapshot.mercSkillRanks).toEqual({})
    expect(decoded!.snapshot.mercInventory).toEqual({})
    expect(decoded!.snapshot.mercDisabledAuras).toEqual({})
  })

  it('round-trips disabled merc auras', () => {
    const snap = makeSnapshot({ mercDisabledAuras: { 'holy aura': true } })
    const decoded = decodeShareToBuild(encodeBuildToShare(snap))
    expect(decoded!.snapshot.mercDisabledAuras).toEqual({ 'holy aura': true })
  })

  it('omits empty ether/merc fields from the encoded payload', () => {
    const code = encodeBuildToShare(makeSnapshot())
    const json = decompressFromEncodedURIComponent(code)
    const payload = JSON.parse(json!) as Record<string, unknown>
    expect(payload).not.toHaveProperty('et')
    expect(payload).not.toHaveProperty('mc')
    expect(payload).not.toHaveProperty('ms')
    expect(payload).not.toHaveProperty('mi')
  })
})

describe('legacy incarnation field (`it`)', () => {
  it('merges legacy `it` node ids into allocatedTreeNodes on decode', () => {
    const code = encodeBuildToShare(makeSnapshot())
    const payload = JSON.parse(
      decompressFromEncodedURIComponent(code)!,
    ) as Record<string, unknown>
    delete payload.h
    payload.it = [5, 11]
    const legacyCode = compressToEncodedURIComponent(JSON.stringify(payload))

    const decoded = decodeShareToBuild(legacyCode)
    expect(decoded).not.toBeNull()
    expect([...decoded!.snapshot.allocatedTreeNodes].sort((a, b) => a - b)).toEqual(
      [1, 2, 3, 5, 11],
    )
  })

  it('never writes the legacy field when encoding', () => {
    const code = encodeBuildToShare(makeSnapshot())
    const json = decompressFromEncodedURIComponent(code)
    const payload = JSON.parse(json!) as Record<string, unknown>
    expect(payload).not.toHaveProperty('it')
  })
})

describe('parseBuildCodeFromInput', () => {
  it('extracts code from a hash URL', () => {
    expect(parseBuildCodeFromInput('https://example.com/#b=ABC123')).toBe('ABC123')
  })

  it('extracts code from a query URL', () => {
    expect(parseBuildCodeFromInput('https://example.com/?b=ABC123')).toBe('ABC123')
  })

  it('returns raw code when no URL pattern is found', () => {
    expect(parseBuildCodeFromInput('  ABC123  ')).toBe('ABC123')
  })

  it('returns trimmed input on empty match', () => {
    expect(parseBuildCodeFromInput('  hello  ')).toBe('hello')
  })
})
