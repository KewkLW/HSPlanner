import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRankProgressionPreview } from './useRankProgressionPreview'

function setup(
  ranks: Record<string, number>,
  requiresAllOf?: (id: string) => string | readonly string[] | undefined,
) {
  return renderHook(
    ({ r }: { r: Record<string, number> }) =>
      useRankProgressionPreview(r, requiresAllOf),
    { initialProps: { r: ranks } },
  )
}

describe('useRankProgressionPreview', () => {
  it('starts in live mode exposing the full ranks by reference', () => {
    const ranks = { a: 2, b: 1 }
    const { result } = setup(ranks)

    expect(result.current.progressStep).toBeNull()
    expect(result.current.isPreview).toBe(false)
    expect(result.current.visibleRanks).toBe(ranks)
    expect(result.current.markerId).toBeNull()
    expect(result.current.total).toBe(3)
  })

  it('exposes the first-K prefix counted by skill and the K-th marker', () => {
    const ranks = { a: 2, b: 1 }
    const { result } = setup(ranks)

    act(() => result.current.setProgressStep(2))

    expect(result.current.isPreview).toBe(true)
    expect(result.current.visibleRanks).toEqual({ a: 2 })
    expect(result.current.markerId).toBe('a')
  })

  it('counts a partial rank mid-skill', () => {
    const ranks = { a: 3 }
    const { result } = setup(ranks)

    act(() => result.current.setProgressStep(2))

    expect(result.current.visibleRanks).toEqual({ a: 2 })
    expect(result.current.markerId).toBe('a')
  })

  it('reflects requires-based reordering in the marker sequence', () => {
    const ranks = { c: 1, a: 1, b: 1 }
    const requires = (id: string): string | undefined => {
      if (id === 'b') return 'a'
      if (id === 'c') return 'b'
      return undefined
    }
    const { result } = setup(ranks, requires)

    act(() => result.current.setProgressStep(1))
    expect(result.current.markerId).toBe('a')

    act(() => result.current.setProgressStep(3))
    expect(result.current.markerId).toBe('c')
  })

  it('places the child after every allocated prerequisite', () => {
    const ranks = { child: 1, left: 1, right: 1 }
    const requiresAllOf = (id: string): readonly string[] =>
      id === 'child' ? ['left', 'right'] : []
    const { result } = setup(ranks, requiresAllOf)

    act(() => result.current.setProgressStep(2))

    expect(result.current.visibleRanks).toEqual({ left: 1, right: 1 })
    expect(result.current.markerId).toBe('right')
  })

  it('computes total as the sum of all ranks regardless of preview step', () => {
    const { result } = setup({ a: 2, b: 3 })
    expect(result.current.total).toBe(5)

    act(() => result.current.setProgressStep(1))
    expect(result.current.total).toBe(5)
  })

  it('snaps back to live mode when the ranks reference changes', () => {
    const { result, rerender } = setup({ a: 2, b: 1 })
    act(() => result.current.setProgressStep(2))
    expect(result.current.isPreview).toBe(true)

    rerender({ r: { a: 2 } })

    expect(result.current.progressStep).toBeNull()
    expect(result.current.isPreview).toBe(false)
    expect(result.current.total).toBe(2)
  })
})
