import { beforeEach, describe, expect, it } from 'vitest'
import { useBuild } from '../build'
import { ADJ, START_IDS } from '../../utils/tree/treeGraph'
import {
  createInitialLoadoutSlots,
  emptyIncarnationLoadout,
  cloneIncarnationLoadout,
} from '../../utils/build/allocationLoadouts'

function firstRootAndChain(): [number, number, number] {
  for (const root of START_IDS) {
    for (const first of ADJ.get(root) ?? []) {
      if (START_IDS.includes(first)) continue
      for (const second of ADJ.get(first) ?? []) {
        if (second !== root && !START_IDS.includes(second)) {
          return [root, first, second]
        }
      }
    }
  }
  throw new Error('Incarnation fixture has no root chain')
}

beforeEach(() => {
  useBuild.setState({
    heroLevel: 0,
    allocatedTreeNodes: new Set<number>(),
    treeSocketed: {},
    incarnationLoadouts: createInitialLoadoutSlots(
      emptyIncarnationLoadout(),
      cloneIncarnationLoadout,
    ),
    activeIncarnationLoadoutIndex: 0,
  })
})

describe('Incarnation Hero-Level cap', () => {
  it('allows exactly one allocated node per Hero Level', () => {
    const [root, first] = firstRootAndChain()
    useBuild.getState().setHeroLevel(1)

    useBuild.getState().toggleTreeNode(root)
    expect([...useBuild.getState().allocatedTreeNodes]).toEqual([root])

    useBuild.getState().toggleTreeNode(first)
    expect([...useBuild.getState().allocatedTreeNodes]).toEqual([root])
  })

  it('rejects an over-budget auto-path atomically', () => {
    const [, first] = firstRootAndChain()
    useBuild.getState().setHeroLevel(1)

    useBuild.getState().toggleTreeNode(first)

    expect(useBuild.getState().allocatedTreeNodes.size).toBe(0)
  })

  it('rejects an optimizer allocation that exceeds the remaining budget', () => {
    const [root, first, second] = firstRootAndChain()
    useBuild.getState().setHeroLevel(2)
    useBuild.getState().toggleTreeNode(root)

    useBuild.getState().applySuggestedNodes([first, second])

    expect([...useBuild.getState().allocatedTreeNodes]).toEqual([root])
  })

  it('still permits deallocation when the point pool is full', () => {
    const [root] = firstRootAndChain()
    useBuild.getState().setHeroLevel(1)
    useBuild.getState().toggleTreeNode(root)

    useBuild.getState().toggleTreeNode(root)

    expect(useBuild.getState().allocatedTreeNodes.size).toBe(0)
  })

  it('will not lower Hero Level below any occupied alternate loadout', () => {
    const slots = createInitialLoadoutSlots(
      emptyIncarnationLoadout(),
      cloneIncarnationLoadout,
    )
    slots[7] = {
      allocatedTreeNodes: new Set([1, 2, 3, 4]),
      treeSocketed: {},
    }
    useBuild.setState({ incarnationLoadouts: slots })

    useBuild.getState().setHeroLevel(2)

    expect(useBuild.getState().heroLevel).toBe(4)
  })

  it('can lower Hero Level after resetting a stale active bank entry', () => {
    const slots = createInitialLoadoutSlots(
      emptyIncarnationLoadout(),
      cloneIncarnationLoadout,
    )
    slots[3] = {
      allocatedTreeNodes: new Set([1, 2, 3, 4]),
      treeSocketed: {},
    }
    useBuild.setState({
      heroLevel: 4,
      allocatedTreeNodes: new Set([1, 2, 3, 4]),
      incarnationLoadouts: slots,
      activeIncarnationLoadoutIndex: 3,
    })

    useBuild.getState().resetTreeNodes()
    useBuild.getState().setHeroLevel(0)

    expect(useBuild.getState().heroLevel).toBe(0)
  })
})
