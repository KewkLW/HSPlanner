import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBuild } from '../../store/build'
import { GEAR_OPTIMIZER_THRESHOLD_MAX } from '../../types'
import { ThresholdControl } from './LeftStatsPanel'

describe('<ThresholdControl>', () => {
  beforeEach(() => {
    useBuild.setState({ gearOptimizerThresholds: {} })
  })

  it('sets and removes an optional minimum', async () => {
    const user = userEvent.setup()
    render(
      <ThresholdControl
        kind="stat"
        statKey="life"
        label="Life"
        currentValue={100}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /add minimum life optimizer threshold/i }),
    )
    const input = screen.getByRole('spinbutton', { name: /minimum value/i })
    await user.clear(input)
    await user.type(input, '250')
    await user.click(screen.getByRole('button', { name: /set minimum/i }))
    expect(useBuild.getState().gearOptimizerThresholds).toEqual({
      'stat:life': 250,
    })

    await user.click(
      screen.getByRole('button', { name: /edit minimum life optimizer threshold/i }),
    )
    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(useBuild.getState().gearOptimizerThresholds).toEqual({})
  })

  it('keeps the modal open and explains an out-of-range value', async () => {
    const user = userEvent.setup()
    render(
      <ThresholdControl
        kind="stat"
        statKey="mana"
        label="Mana"
        currentValue={50}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /add minimum mana optimizer threshold/i }),
    )
    const input = screen.getByRole('spinbutton', { name: /minimum value/i })
    await user.clear(input)
    await user.type(input, String(GEAR_OPTIMIZER_THRESHOLD_MAX + 1))
    await user.click(screen.getByRole('button', { name: /set minimum/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/enter a value from/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(useBuild.getState().gearOptimizerThresholds).toEqual({})
  })
})
