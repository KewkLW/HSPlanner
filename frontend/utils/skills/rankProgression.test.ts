import { describe, expect, it } from 'vitest'
import { rankPointOrder } from './rankProgression'

describe('rankPointOrder', () => {
  it('returns empty array for empty ranks', () => {
    expect(rankPointOrder({})).toEqual([])
  })

  it('expands a single skill into rank-many consecutive points', () => {
    expect(rankPointOrder({ fireball: 3 })).toEqual([
      'fireball',
      'fireball',
      'fireball',
    ])
  })

  it('follows Record key insertion order when there is no requires fn', () => {
    const ranks = { b: 1, a: 2 }
    expect(rankPointOrder(ranks)).toEqual(['b', 'a', 'a'])
  })

  it('repairs a requires chain inserted out of order (A -> B -> C)', () => {
    const ranks = { c: 1, a: 1, b: 1 }
    const requires = (id: string): string | undefined => {
      if (id === 'b') return 'a'
      if (id === 'c') return 'b'
      return undefined
    }
    expect(rankPointOrder(ranks, requires)).toEqual(['a', 'b', 'c'])
  })

  it('places every allocated prerequisite before a multi-parent child', () => {
    const ranks = { child: 1, left: 1, right: 1 }
    const requiresAllOf = (id: string): readonly string[] =>
      id === 'child' ? ['left', 'right'] : []
    expect(rankPointOrder(ranks, requiresAllOf)).toEqual([
      'left',
      'right',
      'child',
    ])
  })

  it('waits for every allocated parent but ignores an absent one', () => {
    const ranks = { child: 1, left: 1 }
    const requiresAllOf = (id: string): readonly string[] =>
      id === 'child' ? ['left', 'unallocated-right'] : []
    expect(rankPointOrder(ranks, requiresAllOf)).toEqual(['left', 'child'])
  })

  it('treats a prerequisite absent from ranks as satisfied (points not lost)', () => {
    const ranks = { x: 2 }
    const requires = (id: string): string | undefined =>
      id === 'x' ? 'unallocated-y' : undefined
    expect(rankPointOrder(ranks, requires)).toEqual(['x', 'x'])
  })

  it('appends unresolvable leftovers (cyclic requires) in input order', () => {
    const ranks = { a: 1, b: 1 }
    const requires = (id: string): string | undefined => {
      if (id === 'a') return 'b'
      if (id === 'b') return 'a'
      return undefined
    }
    expect(rankPointOrder(ranks, requires)).toEqual(['a', 'b'])
  })

  it('mixes resolvable and unresolvable skills, keeping resolvable ones first', () => {
    const ranks = { a: 1, d: 2, b: 1 }
    const requires = (id: string): string | undefined => {
      if (id === 'a') return 'b'
      if (id === 'b') return 'a'
      return undefined
    }
    expect(rankPointOrder(ranks, requires)).toEqual(['d', 'd', 'a', 'b'])
  })
})
