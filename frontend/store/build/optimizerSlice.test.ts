import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER,
  GEAR_OPTIMIZER_THRESHOLD_MAX,
  type GearOptimizerRarityFilter,
} from '../../types'
import { loadProfileSnapshot } from '../../utils/build/savedBuilds'
import { makeSnapshot } from '../../utils/build/buildSnapshot.fixture'
import { useBuild } from './index'

describe('build store — gear optimizer constraints', () => {
  beforeEach(() => {
    localStorage.clear()
    useBuild.getState().resetBuild()
  })

  it('accepts supported finite thresholds and removes them with null', () => {
    useBuild.getState().setGearOptimizerThreshold('stat:life', 12_345.5)
    expect(useBuild.getState().gearOptimizerThresholds).toEqual({
      'stat:life': 12_345.5,
    })

    useBuild.getState().setGearOptimizerThreshold('stat:life', null)
    expect(useBuild.getState().gearOptimizerThresholds).toEqual({})
  })

  it('rejects unsupported, non-finite, and out-of-range thresholds', () => {
    useBuild.getState().setGearOptimizerThreshold('stat:life', 100)
    useBuild.getState().setGearOptimizerThreshold('stat:hidden_stat', 50)
    useBuild.getState().setGearOptimizerThreshold('stat:life', Number.NaN)
    useBuild.getState().setGearOptimizerThreshold('stat:life', Number.POSITIVE_INFINITY)
    useBuild
      .getState()
      .setGearOptimizerThreshold('stat:life', GEAR_OPTIMIZER_THRESHOLD_MAX + 1)

    expect(useBuild.getState().gearOptimizerThresholds).toEqual({
      'stat:life': 100,
    })
  })

  it('accepts valid rarity filters and ignores invalid setter input', () => {
    useBuild.getState().setGearOptimizerRarityFilter({
      mode: 'at_least',
      rarity: 'heroic',
    })
    useBuild.getState().setGearOptimizerRarityFilter({
      mode: 'bogus',
      rarity: 'relic',
    } as unknown as GearOptimizerRarityFilter)

    expect(useBuild.getState().gearOptimizerRarityFilter).toEqual({
      mode: 'at_least',
      rarity: 'heroic',
    })
  })

  it('sanitizes direct snapshot imports', () => {
    useBuild.getState().importBuildSnapshot(
      makeSnapshot({
        gearOptimizerThresholds: {
          'attribute:intelligence': 250,
          'stat:not_visible': 999,
          'stat:mana': GEAR_OPTIMIZER_THRESHOLD_MAX + 1,
        },
        gearOptimizerRarityFilter: {
          mode: 'bad-mode',
          rarity: 'relic',
        } as unknown as GearOptimizerRarityFilter,
      }),
    )

    expect(useBuild.getState().gearOptimizerThresholds).toEqual({
      'attribute:intelligence': 250,
    })
    expect(useBuild.getState().gearOptimizerRarityFilter).toEqual(
      DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER,
    )
  })

  it('persists optimizer constraints through a saved profile', () => {
    useBuild.getState().setGearOptimizerThreshold('stat:cold_resistance', 75)
    useBuild.getState().setGearOptimizerRarityFilter({
      mode: 'exact',
      rarity: 'angelic',
    })
    const saved = useBuild.getState().saveCurrentAsNewBuild('Optimizer state')
    expect(saved).not.toBeNull()

    useBuild.getState().resetBuild()
    expect(useBuild.getState().loadSavedBuild(saved!.id)).toBe(true)

    expect(useBuild.getState().gearOptimizerThresholds).toEqual({
      'stat:cold_resistance': 75,
    })
    expect(useBuild.getState().gearOptimizerRarityFilter).toEqual({
      mode: 'exact',
      rarity: 'angelic',
    })
    expect(
      loadProfileSnapshot(saved!.id, saved!.activeProfileId)
        ?.gearOptimizerThresholds,
    ).toEqual({ 'stat:cold_resistance': 75 })
  })

  it('resetBuild restores empty/default optimizer constraints', () => {
    useBuild.getState().setGearOptimizerThreshold('stat:mana', 500)
    useBuild.getState().setGearOptimizerRarityFilter({
      mode: 'at_most',
      rarity: 'rare',
    })

    useBuild.getState().resetBuild()

    expect(useBuild.getState().gearOptimizerThresholds).toEqual({})
    expect(useBuild.getState().gearOptimizerRarityFilter).toEqual(
      DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER,
    )
  })
})
