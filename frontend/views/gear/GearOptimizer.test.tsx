import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { items } from '@data'
import { useBuildPerformanceDeps } from '../../hooks/useBuildPerformanceDeps'
import { useBuild } from '../../store/build'
import type { BuildPerformanceDeps } from '../../utils/build/buildPerformance'
import {
  optimizeGearNative,
  type GearOptimizerResult,
} from '../../utils/calc/bridge'
import { GearOptimizer } from './GearOptimizer'

vi.mock('../../hooks/useBuildPerformanceDeps', () => ({
  useBuildPerformanceDeps: vi.fn(),
}))
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type BridgeModule = typeof import('../../utils/calc/bridge')
vi.mock('../../utils/calc/bridge', async (importOriginal) => {
  const original = await importOriginal<BridgeModule>()
  return { ...original, optimizeGearNative: vi.fn() }
})

const mockDeps = vi.mocked(useBuildPerformanceDeps)
const mockOptimize = vi.mocked(optimizeGearNative)
const initialState = useBuild.getState()

function deps(
  overrides: Partial<BuildPerformanceDeps> = {},
): BuildPerformanceDeps {
  return {
    classId: 'jotunn',
    level: 100,
    allocatedAttrs: {
      strength: 0,
      dexterity: 0,
      intelligence: 100,
      energy: 0,
      vitality: 0,
      armor: 0,
    },
    inventory: {},
    skillRanks: { orb_of_frost: 20, blizzard: 20 },
    subskillRanks: {},
    activeAuraId: null,
    activeBuffs: {},
    customStats: [],
    allocatedTreeNodes: new Set(),
    treeSocketed: {},
    activeSkillIds: ['orb_of_frost', 'blizzard'],
    enemyConditions: {},
    playerConditions: {},
    skillProjectiles: {},
    enemyResistances: {},
    procToggles: {},
    killsPerSec: 1,
    ...overrides,
  }
}

const weapon = items.find((item) => item.slot === 'weapon' && !item.twoHanded)!
const RESULT: GearOptimizerResult = {
  baseIds: { weapon: weapon.id },
  beforeScore: 100,
  afterScore: 150,
  evaluated: 1234,
  passes: 4,
  thresholdsMet: true,
  thresholdValues: {},
  exact: false,
}

beforeEach(() => {
  useBuild.setState(initialState, true)
  mockDeps.mockReset()
  mockOptimize.mockReset()
  mockDeps.mockReturnValue(deps())
})

describe('<GearOptimizer>', () => {
  it('shows separate disabled controls for relics, charms, and potions', () => {
    render(<GearOptimizer />)
    for (const category of ['Relics', 'Charms', 'Potions']) {
      expect(
        screen.getByRole('checkbox', { name: `Optimize ${category}` }),
      ).toBeDisabled()
      expect(
        screen.getByRole('checkbox', { name: `Optimize ${category}` }),
      ).not.toBeChecked()
    }
    expect(screen.getAllByText(/coming later/i)).toHaveLength(3)
    expect(screen.getByText(/none set.*no stat requirements/i)).toBeInTheDocument()
  })

  it('defaults to the configured primary spell and sends only that target', async () => {
    mockOptimize.mockResolvedValue(RESULT)
    render(<GearOptimizer />)
    expect(screen.getByRole('combobox', { name: /spell to optimize/i })).toHaveValue(
      'orb_of_frost',
    )

    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))
    await waitFor(() => expect(mockOptimize).toHaveBeenCalledTimes(1))
    expect(mockOptimize.mock.calls[0]![1]).toBe('orb_of_frost')
    expect(mockOptimize.mock.calls[0]![2]).toEqual(
      expect.objectContaining({ thresholds: {}, rarityFilter: null }),
    )
  })

  it('uses an allocated damage spell without a separately configured primary', async () => {
    mockDeps.mockReturnValue(deps({ activeSkillIds: [] }))
    mockOptimize.mockResolvedValue(RESULT)
    render(<GearOptimizer />)

    expect(screen.getByRole('button', { name: /optimize gear/i })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: /spell to optimize/i })).toHaveValue(
      'orb_of_frost',
    )

    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))
    await waitFor(() => expect(mockOptimize).toHaveBeenCalledTimes(1))
    expect(mockOptimize.mock.calls[0]![1]).toBe('orb_of_frost')
  })

  it('lets the user select another allocated spell', async () => {
    mockOptimize.mockResolvedValue(RESULT)
    render(<GearOptimizer />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /spell to optimize/i }),
      'blizzard',
    )
    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))
    await waitFor(() => expect(mockOptimize).toHaveBeenCalledTimes(1))
    expect(mockOptimize.mock.calls[0]![1]).toBe('blizzard')
  })

  it('shows progress, previews the result, and applies only on request', async () => {
    let resolve: (result: GearOptimizerResult) => void = () => {}
    mockOptimize.mockImplementation((_deps, _skill, options) => {
      options.onProgress?.(200, 1000)
      return new Promise((done) => {
        resolve = done
      })
    })
    render(<GearOptimizer />)
    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))
    expect(await screen.findByText(/evaluating 200/i)).toBeInTheDocument()
    expect(useBuild.getState().inventory.weapon).toBeUndefined()

    resolve(RESULT)
    expect(await screen.findByText(/best loadout found/i)).toBeInTheDocument()
    expect(screen.getByText('+50.0%')).toBeInTheDocument()
    expect(useBuild.getState().inventory.weapon).toBeUndefined()

    await userEvent.click(screen.getByRole('button', { name: /apply loadout/i }))
    expect(useBuild.getState().inventory.weapon?.baseId).toBe(weapon.id)
  })

  it('passes the selected rarity rule to the native optimizer', async () => {
    mockOptimize.mockResolvedValue(RESULT)
    render(<GearOptimizer />)

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /rarity filter mode/i }),
      'at_least',
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /rarity tier/i }),
      'satanic',
    )
    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))

    await waitFor(() => expect(mockOptimize).toHaveBeenCalledTimes(1))
    expect(mockOptimize.mock.calls[0]![2]).toEqual(
      expect.objectContaining({
        thresholds: {},
        rarityFilter: { mode: 'at_least', rarity: 'satanic' },
      }),
    )
  })

  it('shows active minimums and each resulting actual value', async () => {
    useBuild.setState({
      gearOptimizerThresholds: {
        'stat:life': 2500,
        'stat:fire_resistance': 100,
      },
    })
    mockOptimize.mockResolvedValue({
      ...RESULT,
      thresholdValues: {
        'stat:life': 2750,
        'stat:fire_resistance': 115,
      },
    })
    render(<GearOptimizer />)

    const activeList = screen.getByRole('list', {
      name: /active optimization minimums/i,
    })
    expect(within(activeList).getByText(/life/i)).toHaveTextContent('≥ 2,500')
    expect(within(activeList).getByText(/fire resistance/i)).toHaveTextContent(
      '≥ 100%',
    )

    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))
    await screen.findByRole('status')

    expect(mockOptimize.mock.calls[0]![2]).toEqual(
      expect.objectContaining({
        thresholds: {
          'stat:life': 2500,
          'stat:fire_resistance': 100,
        },
      }),
    )
    const results = screen.getByRole('list', {
      name: /optimization minimum results/i,
    })
    expect(within(results).getByText(/2,750/)).toHaveTextContent('met')
    expect(within(results).getByText(/115%/)).toHaveTextContent('met')
  })

  it('uses the same bounded threshold tolerance as the native optimizer', async () => {
    useBuild.setState({
      gearOptimizerThresholds: { 'stat:life': 1000.0000005 },
    })
    mockOptimize.mockResolvedValue({
      ...RESULT,
      thresholdsMet: true,
      thresholdValues: { 'stat:life': 1000 },
    })
    render(<GearOptimizer />)

    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))

    const results = await screen.findByRole('list', {
      name: /optimization minimum results/i,
    })
    expect(within(results).getByText('Life').closest('li')).toHaveTextContent(
      'met',
    )
  })

  it('keeps a stale native run locked until it settles', async () => {
    let resolve: (result: GearOptimizerResult) => void = () => {}
    mockOptimize.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    render(<GearOptimizer />)

    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))
    act(() => {
      useBuild.getState().setGearOptimizerThreshold('stat:life', 500)
    })

    expect(screen.getByRole('button', { name: /optimizing/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /optimizing/i }))
    expect(mockOptimize).toHaveBeenCalledTimes(1)

    act(() => resolve(RESULT))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /optimize gear/i })).toBeEnabled(),
    )
    expect(screen.queryByText(/best loadout found/i)).not.toBeInTheDocument()
  })

  it('applies the exact clean-base projection for a configured same-base item', async () => {
    const configured = {
      baseId: weapon.id,
      affixes: [{ affixId: 'custom-roll', tier: 1, roll: 1 }],
      socketCount: 0,
      socketed: [],
      socketTypes: [],
      stars: 0,
      forgedMods: [],
    }
    useBuild.setState({ inventory: { weapon: configured } })
    mockDeps.mockReturnValue(deps({ inventory: { weapon: configured } }))
    mockOptimize.mockResolvedValue(RESULT)
    render(<GearOptimizer />)

    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))
    expect(await screen.findByText(/\(configured\)/i)).toBeInTheDocument()
    expect(screen.getByText(/\(clean base\)/i)).toBeInTheDocument()

    const apply = screen.getByRole('button', { name: /apply loadout/i })
    expect(apply).toBeEnabled()
    await userEvent.click(apply)
    expect(useBuild.getState().inventory.weapon?.affixes).toEqual([])
  })

  it('labels an unmet result as closest and prevents applying it', async () => {
    useBuild.setState({
      gearOptimizerThresholds: { 'stat:life': 2500 },
    })
    mockOptimize.mockResolvedValue({
      ...RESULT,
      thresholdsMet: false,
      thresholdValues: { 'stat:life': 2200 },
    })
    render(<GearOptimizer />)

    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))

    expect(await screen.findByText(/closest loadout found/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /no searched loadout met every minimum/i,
    )
    expect(screen.getByText(/2,200/)).toHaveTextContent('not met')
    expect(screen.getByRole('button', { name: /apply loadout/i })).toBeDisabled()
    expect(useBuild.getState().inventory.weapon).toBeUndefined()
  })

  it('disables optimization when no damaging spell is allocated', () => {
    mockDeps.mockReturnValue(
      deps({ activeSkillIds: [], skillRanks: {} }),
    )
    render(<GearOptimizer />)
    expect(screen.getByRole('button', { name: /optimize gear/i })).toBeDisabled()
    expect(screen.getByText(/allocate a damaging active spell/i)).toBeInTheDocument()
  })

  it('shows an error and allows another run', async () => {
    mockOptimize.mockRejectedValue(new Error('native search failed'))
    render(<GearOptimizer />)
    await userEvent.click(screen.getByRole('button', { name: /optimize gear/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('native search failed')
    expect(screen.getByRole('button', { name: /optimize gear/i })).toBeEnabled()
  })
})
