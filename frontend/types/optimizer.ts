import type { ItemRarity } from './item'

export type GearOptimizerRarity = Exclude<
  ItemRarity,
  'satanic_set' | 'relic'
>

export type GearOptimizerRarityMode =
  | 'any'
  | 'exact'
  | 'at_least'
  | 'at_most'

export interface GearOptimizerRarityFilter {
  mode: GearOptimizerRarityMode
  rarity: GearOptimizerRarity
}

export const GEAR_OPTIMIZER_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'mythic',
  'satanic',
  'heroic',
  'angelic',
  'unholy',
] as const satisfies readonly GearOptimizerRarity[]

export const GEAR_OPTIMIZER_RARITY_MODES = [
  'any',
  'exact',
  'at_least',
  'at_most',
] as const satisfies readonly GearOptimizerRarityMode[]

export type GearOptimizerThresholdKind = 'attribute' | 'stat'

// Threshold controls currently exist only for these rows in the left stats
// rail. Imported codes must not create invisible constraints that the user
// cannot inspect or remove.
export const GEAR_OPTIMIZER_ATTRIBUTE_THRESHOLD_KEYS = [
  'strength',
  'dexterity',
  'intelligence',
  'energy',
  'vitality',
  'armor',
] as const

export const GEAR_OPTIMIZER_STAT_THRESHOLD_KEYS = [
  'enhanced_damage',
  'attack_damage',
  'increased_attack_speed',
  'faster_cast_rate',
  'crit_chance',
  'crit_damage',
  'life_steal',
  'mana_steal',
  'life',
  'mana',
  'life_replenish',
  'mana_replenish',
  'block_chance',
  'physical_damage_reduction',
  'magic_damage_reduction',
  'fire_resistance',
  'cold_resistance',
  'lightning_resistance',
  'poison_resistance',
  'arcane_resistance',
] as const

export const GEAR_OPTIMIZER_THRESHOLD_MIN = -1_000_000_000_000_000
export const GEAR_OPTIMIZER_THRESHOLD_MAX = 1_000_000_000_000_000
export const GEAR_OPTIMIZER_THRESHOLD_EPSILON = 1e-9

export function meetsGearOptimizerThreshold(
  actual: number,
  minimum: number,
): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(minimum)) return false
  const tolerance = Math.min(
    GEAR_OPTIMIZER_THRESHOLD_EPSILON *
      Math.max(Math.abs(actual), Math.abs(minimum), 1),
    1e-6,
  )
  return actual + tolerance >= minimum
}

export function gearOptimizerThresholdId(
  kind: GearOptimizerThresholdKind,
  statKey: string,
): string {
  return `${kind}:${statKey}`
}

export const GEAR_OPTIMIZER_THRESHOLD_IDS = [
  ...GEAR_OPTIMIZER_ATTRIBUTE_THRESHOLD_KEYS.map((key) =>
    gearOptimizerThresholdId('attribute', key),
  ),
  ...GEAR_OPTIMIZER_STAT_THRESHOLD_KEYS.map((key) =>
    gearOptimizerThresholdId('stat', key),
  ),
] as const

export const MAX_GEAR_OPTIMIZER_THRESHOLDS =
  GEAR_OPTIMIZER_THRESHOLD_IDS.length

const thresholdIds = new Set<string>(GEAR_OPTIMIZER_THRESHOLD_IDS)
const rarityModes = new Set<string>(GEAR_OPTIMIZER_RARITY_MODES)
const rarities = new Set<string>(GEAR_OPTIMIZER_RARITIES)

export function isGearOptimizerThresholdId(id: unknown): id is string {
  return typeof id === 'string' && thresholdIds.has(id)
}

export function isGearOptimizerThresholdValue(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= GEAR_OPTIMIZER_THRESHOLD_MIN &&
    value <= GEAR_OPTIMIZER_THRESHOLD_MAX
  )
}

export function sanitizeGearOptimizerThresholds(
  input: unknown,
): Record<string, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const record = input as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const id of GEAR_OPTIMIZER_THRESHOLD_IDS) {
    if (!Object.hasOwn(record, id)) continue
    const value = record[id]
    if (isGearOptimizerThresholdValue(value)) out[id] = value
  }
  return out
}

export function parseGearOptimizerThresholdId(
  id: string,
): { kind: GearOptimizerThresholdKind; statKey: string } | null {
  const separator = id.indexOf(':')
  if (separator <= 0 || separator === id.length - 1) return null
  const kind = id.slice(0, separator)
  if (kind !== 'attribute' && kind !== 'stat') return null
  return { kind, statKey: id.slice(separator + 1) }
}

export interface GearOptimizerConstraints {
  thresholds: Record<string, number>
  rarityFilter: GearOptimizerRarityFilter | null
}

export interface GearOptimizerResult {
  baseIds: Record<string, string>
  beforeScore: number
  afterScore: number
  evaluated: number
  passes: number
  thresholdsMet: boolean
  thresholdValues: Record<string, number>
  exact: boolean
}

export const DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER: GearOptimizerRarityFilter = {
  mode: 'any',
  rarity: 'satanic',
}

export function isGearOptimizerRarityFilter(
  input: unknown,
): input is GearOptimizerRarityFilter {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const record = input as Record<string, unknown>
  return (
    typeof record.mode === 'string' &&
    rarityModes.has(record.mode) &&
    typeof record.rarity === 'string' &&
    rarities.has(record.rarity)
  )
}

export function sanitizeGearOptimizerRarityFilter(
  input: unknown,
): GearOptimizerRarityFilter {
  return isGearOptimizerRarityFilter(input)
    ? { mode: input.mode, rarity: input.rarity }
    : { ...DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER }
}
