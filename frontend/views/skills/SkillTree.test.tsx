import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Skill } from '../../types'
import { SkillTree } from './SkillTree'

const frostOrb: Skill = {
  id: 'frost_orb',
  classId: 'white_mage',
  name: 'Frost Orb',
  kind: 'active',
  maxRank: 20,
  ranks: [],
  damageType: 'cold',
  tree: 'Frost',
  position: { row: 0, col: 0 },
}

const frostNova: Skill = {
  ...frostOrb,
  id: 'frost_nova',
  name: 'Frost Nova',
  requiresSkill: frostOrb.id,
  position: { row: 1, col: 0 },
}

const iceShard: Skill = {
  ...frostOrb,
  id: 'ice_shard',
  name: 'Ice Shard',
  position: { row: 0, col: 2 },
}

const blizzard: Skill = {
  ...frostOrb,
  id: 'blizzard',
  name: 'Blizzard',
  requiresAllOf: [frostOrb.id, iceShard.id],
  position: { row: 1, col: 1 },
}

function renderTree({
  list = [frostOrb],
  skillRanks = {},
  canIncrement = true,
}: {
  list?: Skill[]
  skillRanks?: Record<string, number>
  canIncrement?: boolean
} = {}) {
  const onSelect = vi.fn()
  const onInc = vi.fn()
  const onDec = vi.fn()

  const view = render(
    <SkillTree
      name="Frost"
      list={list}
      skillRanks={skillRanks}
      skillBonuses={{}}
      canIncrement={canIncrement}
      hoveredId={null}
      selectedId={null}
      highlightId={null}
      progressMarkerId={null}
      onHover={() => {}}
      onSelect={onSelect}
      onInc={onInc}
      onDec={onDec}
      onOpenSubtree={() => {}}
    />,
  )

  return { ...view, onSelect, onInc, onDec }
}

describe('SkillTree icon allocation', () => {
  it('keeps the skill-name hover label available before and after allocation', () => {
    const unallocated = renderTree()
    expect(
      screen.getByRole('button', {
        name: 'Frost Orb, rank 0 of 20, add point',
      }),
    ).toHaveAttribute('title', 'Frost Orb')

    unallocated.unmount()
    renderTree({ skillRanks: { [frostOrb.id]: 1 } })
    expect(
      screen.getByRole('button', {
        name: 'Frost Orb, rank 1 of 20, add point',
      }),
    ).toHaveAttribute('title', 'Frost Orb')
  })

  it('includes the skill name and prerequisite in a locked hover label', () => {
    renderTree({ list: [frostOrb, frostNova] })

    expect(
      screen.getByRole('button', {
        name: 'Frost Nova, rank 0 of 20, locked, requires Frost Orb',
      }),
    ).toHaveAttribute('title', 'Frost Nova — Requires Frost Orb')
  })

  it('selects the skill and adds a point when its icon is left-clicked', async () => {
    const user = userEvent.setup()
    const { onSelect, onInc } = renderTree()

    await user.click(
      screen.getByRole('button', {
        name: 'Frost Orb, rank 0 of 20, add point',
      }),
    )

    expect(onSelect).toHaveBeenCalledWith(frostOrb.id)
    expect(onInc).toHaveBeenCalledWith(
      frostOrb.id,
      frostOrb.maxRank,
      expect.any(Object),
    )
    expect(screen.getByText('0')).toHaveClass('pointer-events-none')
  })

  it('preserves allocation modifiers from icon clicks', () => {
    const { onInc } = renderTree()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Frost Orb, rank 0 of 20, add point',
      }),
      { shiftKey: true, ctrlKey: true },
    )

    const event = onInc.mock.calls[0]?.[2] as React.MouseEvent
    expect(event.shiftKey).toBe(true)
    expect(event.ctrlKey).toBe(true)
  })

  it('supports keyboard allocation through the icon button', async () => {
    const user = userEvent.setup()
    const { onSelect, onInc } = renderTree()
    const icon = screen.getByRole('button', {
      name: 'Frost Orb, rank 0 of 20, add point',
    })

    icon.focus()
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith(frostOrb.id)
    expect(onInc).toHaveBeenCalledTimes(1)
  })

  it('still selects but does not allocate when no points are available', async () => {
    const user = userEvent.setup()
    const { onSelect, onInc } = renderTree({ canIncrement: false })

    await user.click(
      screen.getByRole('button', {
        name: 'Frost Orb, rank 0 of 20, no skill points available',
      }),
    )

    expect(onSelect).toHaveBeenCalledWith(frostOrb.id)
    expect(onInc).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: 'Add point to Frost Orb' }),
    ).not.toBeInTheDocument()
  })

  it('still selects but does not allocate a prerequisite-locked skill', async () => {
    const user = userEvent.setup()
    const { onSelect, onInc } = renderTree({ list: [frostOrb, frostNova] })

    await user.click(
      screen.getByRole('button', {
        name: 'Frost Nova, rank 0 of 20, locked, requires Frost Orb',
      }),
    )

    expect(onSelect).toHaveBeenCalledWith(frostNova.id)
    expect(onInc).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: 'Add point to Frost Nova' }),
    ).not.toBeInTheDocument()
  })

  it('shows every prerequisite and stays locked while none have ranks', async () => {
    const user = userEvent.setup()
    const { container, onSelect, onInc } = renderTree({
      list: [frostOrb, iceShard, blizzard],
    })

    await user.click(
      screen.getByRole('button', {
        name: 'Blizzard, rank 0 of 20, locked, requires Frost Orb and Ice Shard',
      }),
    )

    expect(onSelect).toHaveBeenCalledWith(blizzard.id)
    expect(onInc).not.toHaveBeenCalled()
    const lines = Array.from(container.querySelectorAll('line'))
    expect(lines).toHaveLength(2)
    expect(new Set(lines.map((line) => line.style.stroke))).toHaveLength(1)
  })

  it('stays locked until all prerequisites have ranks', async () => {
    const user = userEvent.setup()
    const { container, onInc } = renderTree({
      list: [frostOrb, iceShard, blizzard],
      skillRanks: { [frostOrb.id]: 1 },
    })

    await user.click(
      screen.getByRole('button', {
        name: 'Blizzard, rank 0 of 20, locked, requires Frost Orb and Ice Shard',
      }),
    )

    expect(onInc).not.toHaveBeenCalled()
    const lines = Array.from(container.querySelectorAll('line'))
    expect(lines).toHaveLength(2)
    expect(new Set(lines.map((line) => line.style.stroke))).toHaveLength(2)
  })

  it('unlocks and satisfies both lines after all prerequisites have ranks', async () => {
    const user = userEvent.setup()
    const { container, onInc } = renderTree({
      list: [frostOrb, iceShard, blizzard],
      skillRanks: { [frostOrb.id]: 1, [iceShard.id]: 1 },
    })

    await user.click(
      screen.getByRole('button', {
        name: 'Blizzard, rank 0 of 20, add point',
      }),
    )

    expect(onInc).toHaveBeenCalledWith(
      blizzard.id,
      blizzard.maxRank,
      expect.any(Object),
    )

    const lines = Array.from(container.querySelectorAll('line'))
    expect(lines).toHaveLength(2)
    expect(new Set(lines.map((line) => line.style.stroke))).toHaveLength(1)
  })

  it('keeps the compact plus control allocation-only', async () => {
    const user = userEvent.setup()
    const { onSelect, onInc } = renderTree()

    await user.click(
      screen.getByRole('button', { name: 'Add point to Frost Orb' }),
    )

    expect(onInc).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
