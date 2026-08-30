import type { EntityRates } from './entityRates'
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string'
import { z } from 'zod'
import type {
  AttributeKey,
  CustomStat,
  EtherLoadout,
  IncarnationLoadout,
  Inventory,
  LoadoutSlots,
  SlotKey,
  SpecLoadout,
  SocketType,
  TreeSocketContent,
} from '../../types'
import {
  AUGMENT_MAX_LEVEL,
  DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER,
  MAX_GEAR_OPTIMIZER_THRESHOLDS,
  SKILL_ELEMENTS,
  sanitizeGearOptimizerRarityFilter,
  sanitizeGearOptimizerThresholds,
  type GearOptimizerRarityFilter,
} from '../../types'
import { activeSeasonId } from '@data'
import { DEFAULT_SEASON_ID, isKnownSeasonId } from '@data/seasons/registry'
import {
  clearSeasonBoundAllocations,
  pruneUnknownAllocationIds,
} from './seasonMigration'
import { sanitizeHtml } from '../sanitizeHtml'
import {
  heroLevelFor,
  incarnationNodeBudgetFor,
  maxAllocatedIncarnationNodes,
  sanitizeHeroLevel,
} from './heroLevel'

const SCHEMA_VERSION = 2

const DEFAULT_ENEMY_RESISTANCE_PCT = 85

export function defaultEnemyResistances(): Record<string, number> {
  return {
    fire: DEFAULT_ENEMY_RESISTANCE_PCT,
    cold: DEFAULT_ENEMY_RESISTANCE_PCT,
    lightning: DEFAULT_ENEMY_RESISTANCE_PCT,
    poison: DEFAULT_ENEMY_RESISTANCE_PCT,
    arcane: DEFAULT_ENEMY_RESISTANCE_PCT,
  }
}
const URL_PARAM = 'b'

const BUILD_CODE_RE_INPUT = new RegExp(`[#&?]${URL_PARAM}=([^&\\s]+)`)

const MAX_LEVEL = 10_000
const MAX_KEY_LENGTH = 200
const MAX_RECORD_ENTRIES = 5_000
const MAX_TREE_NODES = 10_000
const MAX_AFFIXES_PER_ITEM = 64
const MAX_SOCKETS = 32
const MAX_NOTES_LENGTH = 200_000
const MAX_CUSTOM_STATS = 200
const MAX_SHARE_INPUT_LENGTH = 200_000
const LOADOUT_SLOT_COUNT = 8

const FINITE_NUMBER = z.number().finite()
const NON_NEGATIVE_NUMBER = z.number().finite().min(0)
const SAFE_STRING = z.string().max(MAX_KEY_LENGTH)

const recordOfNumbers = z
  .record(SAFE_STRING, FINITE_NUMBER)
  .refine((r) => Object.keys(r).length <= MAX_RECORD_ENTRIES, {
    message: 'too many entries',
  })

const recordOfNonNegativeNumbers = z
  .record(SAFE_STRING, NON_NEGATIVE_NUMBER)
  .refine((r) => Object.keys(r).length <= MAX_RECORD_ENTRIES, {
    message: 'too many entries',
  })

const recordOfBooleans = z
  .record(SAFE_STRING, z.boolean())
  .refine((r) => Object.keys(r).length <= MAX_RECORD_ENTRIES, {
    message: 'too many entries',
  })

const gearOptimizerRarityFilterSchema = z.object({
  mode: z.enum(['any', 'exact', 'at_least', 'at_most']),
  rarity: z.enum([
    'common',
    'uncommon',
    'rare',
    'mythic',
    'satanic',
    'heroic',
    'angelic',
    'unholy',
  ]),
})

const gearOptimizerThresholdsSchema = z
  .record(SAFE_STRING, z.unknown())
  .refine(
    (record) => Object.keys(record).length <= MAX_GEAR_OPTIMIZER_THRESHOLDS,
    { message: 'too many optimizer thresholds' },
  )
  .transform(sanitizeGearOptimizerThresholds)

const equippedAffixSchema = z.object({
  affixId: SAFE_STRING,
  tier: FINITE_NUMBER,
  roll: FINITE_NUMBER,
  customValue: FINITE_NUMBER.optional(),
})

const treeSocketContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), id: SAFE_STRING }),
  z.object({
    kind: z.literal('uncut'),
    affixes: z.array(equippedAffixSchema).max(MAX_AFFIXES_PER_ITEM),
  }),
])

const treeSocketedSchema = z
  .record(SAFE_STRING, treeSocketContentSchema.nullable())
  .refine((r) => Object.keys(r).length <= MAX_RECORD_ENTRIES, {
    message: 'too many tree sockets',
  })

const equippedItemSchema = z
  .object({
    baseId: SAFE_STRING,
    affixes: z.array(equippedAffixSchema).max(MAX_AFFIXES_PER_ITEM).optional(),
    socketCount: FINITE_NUMBER.optional(),
    socketed: z.array(z.string().max(MAX_KEY_LENGTH).nullable()).max(MAX_SOCKETS).optional(),
    socketTypes: z.array(SAFE_STRING).max(MAX_SOCKETS).optional(),
    runewordId: SAFE_STRING.optional(),
    stars: FINITE_NUMBER.optional(),
    forgedMods: z.array(equippedAffixSchema).max(MAX_AFFIXES_PER_ITEM).optional(),
    augment: z
      .object({ id: SAFE_STRING, level: FINITE_NUMBER })
      .optional(),
    implicitOverrides: z
      .record(SAFE_STRING, FINITE_NUMBER)
      .refine((r) => Object.keys(r).length <= MAX_RECORD_ENTRIES, {
        message: 'too many implicit overrides',
      })
      .optional(),
    skillBonusOverrides: z
      .record(SAFE_STRING, FINITE_NUMBER)
      .refine((r) => Object.keys(r).length <= MAX_RECORD_ENTRIES, {
        message: 'too many skill bonus overrides',
      })
      .optional(),
    randomSkillId: SAFE_STRING.optional(),
    randomSkillElement: z.enum(SKILL_ELEMENTS).optional(),
  })
  .passthrough()

const inventorySchema = z
  .record(SAFE_STRING, equippedItemSchema)
  .refine((r) => Object.keys(r).length <= MAX_RECORD_ENTRIES, {
    message: 'too many slots',
  })

const specLoadoutSchema = z.object({
  a: recordOfNonNegativeNumbers,
  s: recordOfNonNegativeNumbers,
  ss: recordOfNonNegativeNumbers,
  m: z.array(z.string().max(MAX_KEY_LENGTH)).max(64),
  u: z.string().max(MAX_KEY_LENGTH).nullable(),
})

const incarnationLoadoutSchema = z.object({
  t: z.array(FINITE_NUMBER).max(MAX_TREE_NODES),
  ts: treeSocketedSchema.optional(),
})

const etherLoadoutSchema = z.object({
  t: z.array(FINITE_NUMBER).max(MAX_TREE_NODES),
})

const loadoutBankSchema = z
  .object({
    s: z.array(specLoadoutSchema.nullable()).max(LOADOUT_SLOT_COUNT),
    si: z
      .number()
      .int()
      .min(0)
      .max(LOADOUT_SLOT_COUNT - 1),
    i: z.array(incarnationLoadoutSchema.nullable()).max(LOADOUT_SLOT_COUNT),
    ii: z
      .number()
      .int()
      .min(0)
      .max(LOADOUT_SLOT_COUNT - 1),
    e: z.array(etherLoadoutSchema.nullable()).max(LOADOUT_SLOT_COUNT),
    ei: z
      .number()
      .int()
      .min(0)
      .max(LOADOUT_SLOT_COUNT - 1),
  })
  .refine(
    (bank) =>
      bank.si < bank.s.length &&
      bank.ii < bank.i.length &&
      bank.ei < bank.e.length,
    { message: 'active loadout index is outside its bank' },
  )

const shareableBuildSchema = z.object({
  v: z.number(),
  c: z.string().max(MAX_KEY_LENGTH).nullable(),
  l: NON_NEGATIVE_NUMBER,
  h: NON_NEGATIVE_NUMBER.optional(),
  a: recordOfNonNegativeNumbers,
  i: inventorySchema,
  s: recordOfNonNegativeNumbers,
  ss: recordOfNonNegativeNumbers,
  t: z.array(FINITE_NUMBER).max(MAX_TREE_NODES),
  m: z
    .union([
      z.string().max(MAX_KEY_LENGTH),
      z.array(z.string().max(MAX_KEY_LENGTH)).max(64),
    ])
    .nullable(),
  u: z.string().max(MAX_KEY_LENGTH).nullable(),
  buf: recordOfBooleans,
  ec: recordOfBooleans,
  pc: recordOfBooleans.optional(),
  sp: recordOfNonNegativeNumbers.optional(),
  er: recordOfNumbers.optional(),
  pt: recordOfBooleans,
  dp: recordOfBooleans.optional(),
  kps: NON_NEGATIVE_NUMBER,
  n: z.string().max(MAX_NOTES_LENGTH).optional(),
  cs: z
    .array(
      z.object({
        k: z.string().max(MAX_KEY_LENGTH),
        v: z.string().max(MAX_KEY_LENGTH),
      }),
    )
    .max(MAX_CUSTOM_STATS)
    .optional(),
  ts: treeSocketedSchema.optional(),
  se: SAFE_STRING.optional(),
  et: z.array(FINITE_NUMBER).max(MAX_TREE_NODES).optional(),
  it: z.array(FINITE_NUMBER).max(MAX_TREE_NODES).optional(),
  mc: z.string().max(MAX_KEY_LENGTH).nullable().optional(),
  ms: recordOfNonNegativeNumbers.optional(),
  mi: inventorySchema.optional(),
  mda: recordOfBooleans.optional(),
  gt: gearOptimizerThresholdsSchema.optional(),
  gr: gearOptimizerRarityFilterSchema.optional(),
  lo: loadoutBankSchema.optional(),
})

interface SpecLoadoutWire {
  a: Record<string, number>
  s: Record<string, number>
  ss: Record<string, number>
  m: string[]
  u: string | null
}

interface IncarnationLoadoutWire {
  t: number[]
  ts?: Record<string, TreeSocketContent | null>
}

interface EtherLoadoutWire {
  t: number[]
}

interface LoadoutBankWire {
  s: Array<SpecLoadoutWire | null>
  si: number
  i: Array<IncarnationLoadoutWire | null>
  ii: number
  e: Array<EtherLoadoutWire | null>
  ei: number
}

export interface ShareableBuild {
  v: number
  c: string | null
  l: number
  h?: number
  a: Record<AttributeKey, number>
  i: Inventory
  s: Record<string, number>
  ss: Record<string, number>
  t: number[]
  m: string | string[] | null
  u: string | null
  buf: Record<string, boolean>
  ec: Record<string, boolean>
  pc?: Record<string, boolean>
  sp?: Record<string, number>
  er?: Record<string, number>
  pt: Record<string, boolean>
  dp?: Record<string, boolean>
  kps: number
  n?: string
  cs?: { k: string; v: string }[]
  ts?: Record<string, TreeSocketContent | null>
  se?: string
  et?: number[]
  it?: number[]
  mc?: string | null
  ms?: Record<string, number>
  mi?: Inventory
  mda?: Record<string, boolean>
  gt?: Record<string, number>
  gr?: GearOptimizerRarityFilter
  lo?: LoadoutBankWire
}

export interface BuildSnapshot {
  classId: string | null
  level: number
  /** Hero Level controls the available Incarnation point pool. */
  heroLevel?: number
  allocated: Record<AttributeKey, number>
  inventory: Inventory
  skillRanks: Record<string, number>
  subskillRanks: Record<string, number>
  allocatedTreeNodes: Set<number>
  activeSkillIds: string[]
  activeAuraId: string | null
  activeBuffs: Record<string, boolean>
  enemyConditions: Record<string, boolean>
  playerConditions: Record<string, boolean>
  skillProjectiles: Record<string, number>
  enemyResistances: Record<string, number>
  procToggles: Record<string, boolean>
  disabledPotions: Record<string, boolean>
  killsPerSec: number
  // Local-only Config knobs; deliberately absent from the share wire format.
  entityRates?: EntityRates
  /// Pre-split builds carried one rate for all three entity kinds.
  entityAttacksPerSecond?: number
  customStats: CustomStat[]
  treeSocketed: Record<number, TreeSocketContent | null>
  allocatedEtherNodes: Set<number>
  mercClassId: string | null
  mercSkillRanks: Record<string, number>
  mercInventory: Inventory
  mercDisabledAuras: Record<string, boolean>
  gearOptimizerThresholds?: Record<string, number>
  gearOptimizerRarityFilter?: GearOptimizerRarityFilter
  /** Optional v2 bank payload. Absent on legacy share codes. */
  specLoadouts?: LoadoutSlots<SpecLoadout>
  activeSpecLoadoutIndex?: number
  incarnationLoadouts?: LoadoutSlots<IncarnationLoadout>
  activeIncarnationLoadoutIndex?: number
  etherLoadouts?: LoadoutSlots<EtherLoadout>
  activeEtherLoadoutIndex?: number
}

function serializeLoadoutBanks(
  snapshot: BuildSnapshot,
): LoadoutBankWire | undefined {
  if (
    !snapshot.specLoadouts ||
    snapshot.activeSpecLoadoutIndex == null ||
    !snapshot.incarnationLoadouts ||
    snapshot.activeIncarnationLoadoutIndex == null ||
    !snapshot.etherLoadouts ||
    snapshot.activeEtherLoadoutIndex == null
  ) {
    return undefined
  }
  if (
    snapshot.specLoadouts.length > LOADOUT_SLOT_COUNT ||
    snapshot.incarnationLoadouts.length > LOADOUT_SLOT_COUNT ||
    snapshot.etherLoadouts.length > LOADOUT_SLOT_COUNT ||
    snapshot.activeSpecLoadoutIndex < 0 ||
    snapshot.activeSpecLoadoutIndex >= snapshot.specLoadouts.length ||
    snapshot.activeIncarnationLoadoutIndex < 0 ||
    snapshot.activeIncarnationLoadoutIndex >=
      snapshot.incarnationLoadouts.length ||
    snapshot.activeEtherLoadoutIndex < 0 ||
    snapshot.activeEtherLoadoutIndex >= snapshot.etherLoadouts.length
  ) {
    return undefined
  }

  const serializeSockets = (
    treeSocketed: Record<number, TreeSocketContent | null>,
  ): Record<string, TreeSocketContent | null> | undefined => {
    const out: Record<string, TreeSocketContent | null> = {}
    for (const [id, content] of Object.entries(treeSocketed)) {
      if (content != null) out[id] = content
    }
    return Object.keys(out).length > 0 ? out : undefined
  }

  return {
    s: snapshot.specLoadouts.map((loadout) =>
      loadout
        ? {
            a: loadout.allocated,
            s: loadout.skillRanks,
            ss: loadout.subskillRanks,
            m: loadout.activeSkillIds,
            u: loadout.activeAuraId,
          }
        : null,
    ),
    si: snapshot.activeSpecLoadoutIndex,
    i: snapshot.incarnationLoadouts.map((loadout) => {
      if (!loadout) return null
      const ts = serializeSockets(loadout.treeSocketed)
      return {
        t: [...loadout.allocatedTreeNodes].sort((x, y) => x - y),
        ...(ts ? { ts } : {}),
      }
    }),
    ii: snapshot.activeIncarnationLoadoutIndex,
    e: snapshot.etherLoadouts.map((loadout) =>
      loadout
        ? { t: [...loadout.allocatedEtherNodes].sort((x, y) => x - y) }
        : null,
    ),
    ei: snapshot.activeEtherLoadoutIndex,
  }
}

function deserializeTreeSockets(
  treeSocketed: Record<string, TreeSocketContent | null> | undefined,
): Record<number, TreeSocketContent | null> {
  if (!treeSocketed) return {}
  return Object.fromEntries(
    Object.entries(treeSocketed)
      .filter(([, content]) => content != null)
      .map(
        ([id, content]) => [Number(id), content as TreeSocketContent] as const,
      )
      .filter(([id]) => Number.isInteger(id) && id >= 0),
  )
}

function serialize(
  snapshot: BuildSnapshot,
  notes: string | undefined,
  seasonId: string,
): ShareableBuild {
  const allocationSnapshot =
    seasonId === activeSeasonId
      ? withPrunedSeasonAllocations(snapshot)
      : snapshot
  const optimizerThresholds = sanitizeGearOptimizerThresholds(
    snapshot.gearOptimizerThresholds,
  )
  const optimizerRarityFilter = sanitizeGearOptimizerRarityFilter(
    snapshot.gearOptimizerRarityFilter,
  )
  const heroLevel = resolveHeroLevel(
    allocationSnapshot,
    snapshot.heroLevel,
  )
  const out: ShareableBuild = {
    v: SCHEMA_VERSION,
    c: snapshot.classId,
    l: snapshot.level,
    h: heroLevel,
    a: snapshot.allocated,
    i: snapshot.inventory,
    s: snapshot.skillRanks,
    ss: snapshot.subskillRanks,
    t: [...allocationSnapshot.allocatedTreeNodes].sort((x, y) => x - y),
    m: snapshot.activeSkillIds,
    u: snapshot.activeAuraId,
    buf: snapshot.activeBuffs,
    ec: snapshot.enemyConditions,
    pt: snapshot.procToggles,
    ...(Object.keys(snapshot.disabledPotions ?? {}).length > 0
      ? { dp: snapshot.disabledPotions }
      : {}),
    ...(Object.keys(snapshot.playerConditions ?? {}).length > 0
      ? { pc: snapshot.playerConditions }
      : {}),
    ...(Object.keys(snapshot.skillProjectiles ?? {}).length > 0
      ? { sp: snapshot.skillProjectiles }
      : {}),
    ...(Object.keys(snapshot.enemyResistances ?? {}).length > 0
      ? { er: snapshot.enemyResistances }
      : {}),
    kps: snapshot.killsPerSec,
    se: seasonId,
  }
  const loadouts = serializeLoadoutBanks(allocationSnapshot)
  if (loadouts) out.lo = loadouts
  if (Object.keys(optimizerThresholds).length > 0) {
    out.gt = optimizerThresholds
  }
  if (
    optimizerRarityFilter.mode !== DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER.mode ||
    optimizerRarityFilter.rarity !== DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER.rarity
  ) {
    out.gr = optimizerRarityFilter
  }
  if (allocationSnapshot.allocatedEtherNodes.size > 0) {
    out.et = [...allocationSnapshot.allocatedEtherNodes].sort(
      (x, y) => x - y,
    )
  }
  if (snapshot.mercClassId) out.mc = snapshot.mercClassId
  if (Object.keys(snapshot.mercSkillRanks ?? {}).length > 0) {
    out.ms = snapshot.mercSkillRanks
  }
  if (Object.keys(snapshot.mercInventory ?? {}).length > 0) {
    out.mi = snapshot.mercInventory
  }
  if (Object.keys(snapshot.mercDisabledAuras ?? {}).length > 0) {
    out.mda = snapshot.mercDisabledAuras
  }
  if (notes) out.n = notes
  if (snapshot.customStats.length > 0) {
    out.cs = snapshot.customStats.map((s) => ({
      k: s.statKey,
      v: s.value,
    }))
  }
  if (
    allocationSnapshot.treeSocketed &&
    Object.keys(allocationSnapshot.treeSocketed).length > 0
  ) {
    const ts: Record<string, TreeSocketContent | null> = {}
    for (const [id, content] of Object.entries(
      allocationSnapshot.treeSocketed,
    )) {
      if (content == null) continue
      ts[id] = content
    }
    if (Object.keys(ts).length > 0) out.ts = ts
  }
  return out
}

export interface DecodedShare {
  snapshot: BuildSnapshot
  notes: string
  season: string
}

function clampLevel(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(n)))
}

function resolveHeroLevel(
  snapshot: BuildSnapshot,
  explicitHeroLevel: number | undefined,
): number {
  const heroLevel =
    explicitHeroLevel === undefined
      ? heroLevelFor({ ...snapshot, heroLevel: undefined })
      : sanitizeHeroLevel(explicitHeroLevel)
  if (
    maxAllocatedIncarnationNodes(snapshot) >
    incarnationNodeBudgetFor(heroLevel)
  ) {
    throw new Error('Incarnation allocation exceeds the Hero-Level budget')
  }
  return heroLevel
}

function withPrunedSeasonAllocations(snapshot: BuildSnapshot): BuildSnapshot {
  return pruneUnknownAllocationIds(snapshot)
}

function deserialize(encoded: ShareableBuild): DecodedShare {
  if (encoded.v !== 1 && encoded.v !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported share schema v${encoded.v} (expected v1..v${SCHEMA_VERSION})`,
    )
  }
  const knownSeason = encoded.se && isKnownSeasonId(encoded.se) ? encoded.se : null
  const season = knownSeason ?? DEFAULT_SEASON_ID
  const snapshot: BuildSnapshot = {
    classId: encoded.c ?? null,
    level: clampLevel(encoded.l ?? 1),
    heroLevel: encoded.h,
    allocated: encoded.a ?? {},
    inventory: normalizeInventory(encoded.i),
    skillRanks: encoded.s ?? {},
    subskillRanks: encoded.ss ?? {},
    activeSkillIds: Array.isArray(encoded.m)
      ? encoded.m
      : encoded.m
        ? [encoded.m]
        : [],
    activeAuraId: encoded.u ?? null,
    activeBuffs: encoded.buf ?? {},
    enemyConditions: encoded.ec ?? {},
    playerConditions: encoded.pc ?? {},
    skillProjectiles: encoded.sp ?? {},
    enemyResistances: encoded.er ?? defaultEnemyResistances(),
    procToggles: encoded.pt ?? {},
    disabledPotions: encoded.dp ?? {},
    killsPerSec: Number.isFinite(encoded.kps) ? encoded.kps : 1,
    customStats: Array.isArray(encoded.cs)
      ? encoded.cs
          .filter((s) => s && typeof s.v === 'string')
          .map((s) => ({
            statKey: typeof s.k === 'string' ? s.k : '',
            value: s.v,
          }))
      : [],
    treeSocketed: deserializeTreeSockets(encoded.ts),
    allocatedTreeNodes: new Set([...(encoded.t ?? []), ...(encoded.it ?? [])]),
    allocatedEtherNodes: new Set(encoded.et ?? []),
    mercClassId: encoded.mc ?? null,
    mercSkillRanks: encoded.ms ?? {},
    mercInventory: normalizeInventory(encoded.mi),
    mercDisabledAuras: encoded.mda ?? {},
    gearOptimizerThresholds: sanitizeGearOptimizerThresholds(encoded.gt),
    gearOptimizerRarityFilter: sanitizeGearOptimizerRarityFilter(encoded.gr),
  }
  if (encoded.lo) {
    snapshot.specLoadouts = encoded.lo.s.map((loadout) =>
      loadout
        ? {
            allocated: loadout.a as Record<AttributeKey, number>,
            skillRanks: loadout.s,
            subskillRanks: loadout.ss,
            activeSkillIds: loadout.m,
            activeAuraId: loadout.u,
          }
        : null,
    )
    snapshot.activeSpecLoadoutIndex = encoded.lo.si
    snapshot.incarnationLoadouts = encoded.lo.i.map((loadout) =>
      loadout
        ? {
            allocatedTreeNodes: new Set(loadout.t),
            treeSocketed: deserializeTreeSockets(loadout.ts),
          }
        : null,
    )
    snapshot.activeIncarnationLoadoutIndex = encoded.lo.ii
    snapshot.etherLoadouts = encoded.lo.e.map((loadout) =>
      loadout ? { allocatedEtherNodes: new Set(loadout.t) } : null,
    )
    snapshot.activeEtherLoadoutIndex = encoded.lo.ei
  }
  // Codes from a season we no longer ship open in the current one. Decode the
  // banks first, then clear every season-bound allocation before inferring a
  // safe current Hero Level.
  const seasonSnapshot = knownSeason
    ? snapshot
    : clearSeasonBoundAllocations(snapshot)
  // Current-season unknown ids must not inflate a legacy Hero Level or make a
  // decoded share impossible to encode again. Preserve non-tree wire fields
  // while canonicalizing both active and banked allocation data.
  const decodedSnapshot =
    season === activeSeasonId
      ? withPrunedSeasonAllocations(seasonSnapshot)
      : seasonSnapshot
  decodedSnapshot.heroLevel = resolveHeroLevel(
    decodedSnapshot,
    knownSeason ? encoded.h : undefined,
  )
  return {
    snapshot: decodedSnapshot,
    notes: encoded.n ? sanitizeHtml(encoded.n) : '',
    season,
  }
}

function normalizeInventory(inv: Inventory | undefined): Inventory {
  if (!inv) return {}
  const out: Inventory = {}
  for (const [slot, item] of Object.entries(inv)) {
    if (!item) continue
    const socketCount = item.socketCount ?? 0
    const socketed = Array.isArray(item.socketed)
      ? item.socketed.slice(0, socketCount)
      : []
    while (socketed.length < socketCount) socketed.push(null)
    const socketTypes: SocketType[] = Array.isArray(item.socketTypes)
      ? (item.socketTypes.slice(0, socketCount) as SocketType[])
      : []
    while (socketTypes.length < socketCount) socketTypes.push('normal')
    const rawStars =
      typeof item.stars === 'number' && Number.isFinite(item.stars)
        ? Math.max(0, Math.min(5, Math.floor(item.stars)))
        : 0
    const aug =
      item.augment &&
      typeof item.augment === 'object' &&
      typeof item.augment.id === 'string' &&
      Number.isFinite(item.augment.level)
        ? {
            id: item.augment.id,
            level: Math.max(1, Math.min(AUGMENT_MAX_LEVEL, Math.floor(item.augment.level))),
          }
        : undefined
    const implicitOverrides =
      item.implicitOverrides &&
      typeof item.implicitOverrides === 'object' &&
      !Array.isArray(item.implicitOverrides)
        ? item.implicitOverrides
        : undefined
    const skillBonusOverrides =
      item.skillBonusOverrides &&
      typeof item.skillBonusOverrides === 'object' &&
      !Array.isArray(item.skillBonusOverrides)
        ? item.skillBonusOverrides
        : undefined
    out[slot as SlotKey] = {
      baseId: item.baseId,
      affixes: Array.isArray(item.affixes) ? item.affixes : [],
      socketCount,
      socketed,
      socketTypes,
      runewordId: item.runewordId,
      stars: rawStars,
      forgedMods: Array.isArray(item.forgedMods) ? item.forgedMods : [],
      ...(aug ? { augment: aug } : {}),
      ...(implicitOverrides ? { implicitOverrides } : {}),
      ...(skillBonusOverrides ? { skillBonusOverrides } : {}),
      ...(typeof item.randomSkillId === 'string'
        ? { randomSkillId: item.randomSkillId }
        : {}),
      ...(item.randomSkillElement ? { randomSkillElement: item.randomSkillElement } : {}),
    }
  }
  return out
}

export function encodeBuildToShare(
  snapshot: BuildSnapshot,
  notes?: string,
  seasonId: string = activeSeasonId,
): string {
  const payload = serialize(snapshot, notes, seasonId)
  const json = JSON.stringify(payload)
  return compressToEncodedURIComponent(json)
}

export function decodeShareToBuild(code: string): DecodedShare | null {
  try {
    if (typeof code !== 'string' || code.length > MAX_SHARE_INPUT_LENGTH) {
      return null
    }
    const json = decompressFromEncodedURIComponent(code)
    if (!json || json.length > MAX_SHARE_INPUT_LENGTH) return null
    const parsed: unknown = JSON.parse(json)
    const result = shareableBuildSchema.safeParse(parsed)
    if (!result.success) return null
    return deserialize(result.data as ShareableBuild)
  } catch {
    return null
  }
}

export function parseBuildCodeFromInput(input: string): string {
  const trimmed = input.trim()
  const m = trimmed.match(BUILD_CODE_RE_INPUT)
  return m && m[1] ? decodeURIComponent(m[1]) : trimmed
}
