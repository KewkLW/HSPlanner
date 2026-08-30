import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_SAVE_DEBOUNCE_MS, initAutoSave } from './autoSave'
import { useBuild } from './build'
import { useSettings } from './settings'
import { loadProfileSnapshot } from '../utils/build/savedBuilds'

function saveFixtureBuild(name: string) {
  const record = useBuild.getState().saveCurrentAsNewBuild(name)
  if (!record) throw new Error('fixture build not saved')
  return { buildId: record.id, profileId: record.activeProfileId }
}

describe('auto-save engine', () => {
  let unsubscribe: () => void

  beforeEach(() => {
    window.localStorage.clear()
    vi.useFakeTimers()
    useSettings.setState({ autoSave: true })
    useBuild.getState().resetBuild()
    unsubscribe = initAutoSave()
  })

  afterEach(() => {
    unsubscribe()
    vi.useRealTimers()
    useBuild.getState().resetBuild()
    useSettings.setState({ autoSave: true })
  })

  it('commits build changes after the debounce when auto-save is on', () => {
    const { buildId, profileId } = saveFixtureBuild('Auto On')
    useBuild.getState().setLevel(50)

    vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS + 1)

    expect(loadProfileSnapshot(buildId, profileId)?.level).toBe(50)
  })

  it('auto-saves gear optimizer constraints', () => {
    const { buildId, profileId } = saveFixtureBuild('Optimizer auto-save')
    useBuild.getState().setGearOptimizerThreshold('stat:life', 25_000)
    useBuild.getState().setGearOptimizerRarityFilter({
      mode: 'at_least',
      rarity: 'satanic',
    })

    vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS + 1)

    const snapshot = loadProfileSnapshot(buildId, profileId)
    expect(snapshot?.gearOptimizerThresholds).toEqual({ 'stat:life': 25_000 })
    expect(snapshot?.gearOptimizerRarityFilter).toEqual({
      mode: 'at_least',
      rarity: 'satanic',
    })
  })

  it('auto-saves independent allocation banks and their active slots', () => {
    const { buildId, profileId } = saveFixtureBuild('Loadout auto-save')
    useBuild.getState().createSpecLoadout(3)
    useBuild.setState({ skillRanks: { frost_orb: 30 } })
    useBuild.getState().createIncarnationLoadout(1)
    useBuild.getState().setHeroLevel(2)
    useBuild.setState({ allocatedTreeNodes: new Set([12, 18]) })
    useBuild.getState().createEtherLoadout(2)
    useBuild.setState({ allocatedEtherNodes: new Set([7, 9]) })

    vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS + 1)

    const snapshot = loadProfileSnapshot(buildId, profileId)
    expect(snapshot?.activeSpecLoadoutIndex).toBe(3)
    expect(snapshot?.specLoadouts?.[3]?.skillRanks).toEqual({ frost_orb: 30 })
    expect(snapshot?.activeIncarnationLoadoutIndex).toBe(1)
    expect([
      ...(snapshot?.incarnationLoadouts?.[1]?.allocatedTreeNodes ?? []),
    ]).toEqual([12, 18])
    expect(snapshot?.activeEtherLoadoutIndex).toBe(2)
    expect([
      ...(snapshot?.etherLoadouts?.[2]?.allocatedEtherNodes ?? []),
    ]).toEqual([7, 9])
  })

  it('does not persist changes when auto-save is off', () => {
    const { buildId, profileId } = saveFixtureBuild('Auto Off')
    useSettings.setState({ autoSave: false })
    useBuild.getState().setLevel(60)

    vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS * 5)

    expect(loadProfileSnapshot(buildId, profileId)?.level).toBe(1)
  })

  it('saveBuildNow persists manually even when auto-save is off', () => {
    const { buildId, profileId } = saveFixtureBuild('Manual')
    useSettings.setState({ autoSave: false })
    useBuild.getState().setLevel(60)

    expect(useBuild.getState().saveBuildNow()).toBe(true)

    expect(loadProfileSnapshot(buildId, profileId)?.level).toBe(60)
  })

  it('discards unsaved edits on build reload when auto-save is off', () => {
    const { buildId, profileId } = saveFixtureBuild('Discard')
    useSettings.setState({ autoSave: false })
    useBuild.getState().setLevel(70)

    useBuild.getState().loadSavedBuild(buildId)

    expect(loadProfileSnapshot(buildId, profileId)?.level).toBe(1)
    expect(useBuild.getState().level).toBe(1)
  })
})
