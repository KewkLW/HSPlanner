import type { AttributeKey } from './game'
import type { TreeSocketContent } from './build'

export const ALLOCATION_LOADOUT_SLOT_COUNT = 8

export type LoadoutSlots<T> = Array<T | null>

export interface SpecLoadout {
  allocated: Record<AttributeKey, number>
  skillRanks: Record<string, number>
  subskillRanks: Record<string, number>
  activeSkillIds: string[]
  activeAuraId: string | null
}

export interface IncarnationLoadout {
  allocatedTreeNodes: Set<number>
  treeSocketed: Record<number, TreeSocketContent | null>
}

export interface EtherLoadout {
  allocatedEtherNodes: Set<number>
}

export interface IndexedLoadoutPatch<T> {
  index: number
  loadout: T | null
}

/** Narrow patch used by the authenticated local build bridge. */
export interface SavedBuildAllocationPatch {
  incarnationLoadouts?: IndexedLoadoutPatch<IncarnationLoadout>[]
  activeIncarnationLoadoutIndex?: number
  etherLoadouts?: IndexedLoadoutPatch<EtherLoadout>[]
  activeEtherLoadoutIndex?: number
  mercClassId?: string | null
  mercSkillRanks?: Record<string, number>
}
