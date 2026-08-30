import type { IncarnationLoadout } from '../../types'

/**
 * The live Season 10 tree is one allocatable node per Hero Level: Kewk's
 * Hero-Level-53 screenshots show 33 allocated / 20 left and 53 / 0. The
 * installed tutorial's older "2 points" sentence is therefore stale (or
 * describes an internal unit the current UI no longer exposes).
 */
export const INCARNATION_POINTS_PER_HERO_LEVEL = 1
export const INCARNATION_POINTS_PER_NODE = 1

interface HeroAllocation {
  heroLevel?: number
  allocatedTreeNodes: ReadonlySet<number>
  incarnationLoadouts?: readonly (IncarnationLoadout | null)[]
  activeIncarnationLoadoutIndex?: number
}

export function sanitizeHeroLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)))
}

export function maxAllocatedIncarnationNodes(alloc: HeroAllocation): number {
  let maximum = alloc.allocatedTreeNodes.size
  for (const [index, loadout] of (
    alloc.incarnationLoadouts ?? []
  ).entries()) {
    // The top-level allocation is the live source of truth for the active
    // slot. Its bank entry is only synchronized when switching or exporting,
    // so counting that stale copy would prevent lowering Hero Level after a
    // deallocation or reset.
    if (index === alloc.activeIncarnationLoadoutIndex) continue
    maximum = Math.max(maximum, loadout?.allocatedTreeNodes.size ?? 0)
  }
  return maximum
}

export function heroLevelFor(alloc: HeroAllocation): number {
  // Legacy share codes did not store Hero Level. Inferring the smallest level
  // that can legally contain every saved loadout preserves those builds while
  // giving them a real point cap as soon as they are loaded again.
  return Math.max(
    sanitizeHeroLevel(alloc.heroLevel),
    maxAllocatedIncarnationNodes(alloc),
  )
}

export function incarnationPointsFor(heroLevel: number): number {
  return sanitizeHeroLevel(heroLevel) * INCARNATION_POINTS_PER_HERO_LEVEL
}

export function incarnationNodeBudgetFor(heroLevel: number): number {
  return Math.floor(
    incarnationPointsFor(heroLevel) / INCARNATION_POINTS_PER_NODE,
  )
}

export function incarnationPointsSpent(nodeCount: number): number {
  return Math.max(0, Math.floor(nodeCount)) * INCARNATION_POINTS_PER_NODE
}
