import { describe, expect, it } from 'vitest'
import {
  heroLevelFor,
  incarnationNodeBudgetFor,
  incarnationPointsFor,
  incarnationPointsSpent,
} from './heroLevel'

describe('heroLevelFor', () => {
  it('uses the explicit Hero Level as the Incarnation cap', () => {
    expect(
      heroLevelFor({ heroLevel: 53, allocatedTreeNodes: new Set([1, 2, 3]) }),
    ).toBe(53)
  })

  it('infers a legacy Hero Level from allocated incarnation-tree nodes', () => {
    expect(heroLevelFor({ allocatedTreeNodes: new Set([1, 2, 3]) })).toBe(3)
  })

  it('migrates from the largest allocation across all eight loadouts', () => {
    expect(
      heroLevelFor({
        allocatedTreeNodes: new Set([1]),
        incarnationLoadouts: [
          { allocatedTreeNodes: new Set([1, 2]), treeSocketed: {} },
          null,
          { allocatedTreeNodes: new Set([1, 2, 3, 4]), treeSocketed: {} },
          null,
          null,
          null,
          null,
          { allocatedTreeNodes: new Set([1, 2, 3]), treeSocketed: {} },
        ],
      }),
    ).toBe(4)
  })

  it('never accepts an explicit level below an occupied loadout', () => {
    expect(
      heroLevelFor({
        heroLevel: 2,
        allocatedTreeNodes: new Set([1, 2, 3]),
      }),
    ).toBe(3)
  })

  it('uses the live top-level allocation instead of a stale active bank entry', () => {
    expect(
      heroLevelFor({
        heroLevel: 0,
        allocatedTreeNodes: new Set([1]),
        activeIncarnationLoadoutIndex: 2,
        incarnationLoadouts: [
          null,
          { allocatedTreeNodes: new Set([1, 2]), treeSocketed: {} },
          {
            allocatedTreeNodes: new Set([1, 2, 3, 4, 5]),
            treeSocketed: {},
          },
          null,
          null,
          null,
          null,
          null,
        ],
      }),
    ).toBe(2)
  })

  it('returns zero for an empty allocation', () => {
    expect(heroLevelFor({ allocatedTreeNodes: new Set() })).toBe(0)
  })
})

describe('Incarnation point budget', () => {
  it('matches the live Season 10 one-point-per-Hero-Level UI', () => {
    expect(incarnationPointsFor(53)).toBe(53)
    expect(incarnationNodeBudgetFor(53)).toBe(53)
    expect(incarnationPointsSpent(33)).toBe(33)
  })
})
