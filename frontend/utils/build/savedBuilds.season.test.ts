import { beforeEach, describe, expect, it } from 'vitest'
import { activeSeasonId } from '@data'
import { DEFAULT_SEASON_ID } from '@data/seasons/registry'
import { makeSnapshot } from './buildSnapshot.fixture'
import { START_IDS } from '../tree/treeGraph'
import { clearSeasonBoundAllocations } from './seasonMigration'
import {
  addProfile,
  createBuild,
  getSavedBuild,
  loadProfileSnapshot,
  migrateBuildProfilesToSeason,
  readLibrary,
  setBuildSeason,
  writeLibrary,
} from './savedBuilds'

beforeEach(() => {
  localStorage.clear()
})

describe('saved build season field', () => {
  it('new builds are stamped with the active season', () => {
    const build = createBuild('Test', makeSnapshot())
    expect(getSavedBuild(build.id)?.season).toBe(activeSeasonId)
  })

  it('legacy builds without season are stamped with the default season on read', () => {
    const build = createBuild('Legacy', makeSnapshot())
    const lib = readLibrary()
    const raw = lib.builds.map((b) => {
      if (b.id !== build.id) return b
      const { season: _drop, ...rest } = b as typeof b & { season?: string }
      return rest as typeof b
    })
    writeLibrary({ ...lib, builds: raw as typeof lib.builds })
    expect(getSavedBuild(build.id)?.season).toBe(DEFAULT_SEASON_ID)
  })

  it('builds from a dropped season are re-stamped with the default season on read', () => {
    const build = createBuild('Old', makeSnapshot())
    const lib = readLibrary()
    writeLibrary({
      ...lib,
      builds: lib.builds.map((b) => (b.id === build.id ? { ...b, season: 's9' } : b)),
    })
    expect(getSavedBuild(build.id)?.season).toBe(DEFAULT_SEASON_ID)
  })

  it('setBuildSeason re-stamps a saved build and returns false for missing ids', () => {
    const build = createBuild('Conv', makeSnapshot())
    expect(setBuildSeason(build.id, 's10')).toBe(true)
    expect(getSavedBuild(build.id)?.season).toBe('s10')
    expect(setBuildSeason('no-such-id', 's10')).toBe(false)
  })

  it('migrates every profile atomically when the build season changes', () => {
    const roots = START_IDS.slice(0, 2)
    expect(roots).toHaveLength(2)
    const firstSnapshot = makeSnapshot({
      heroLevel: 1,
      allocatedTreeNodes: new Set([roots[0]!]),
    })
    const build = createBuild('Profiles', firstSnapshot)
    const secondSnapshot = makeSnapshot({
      heroLevel: 2,
      allocatedTreeNodes: new Set(roots),
    })
    const second = addProfile(build.id, 'Alt', secondSnapshot)!.profile
    const snapshots = new Map([
      [build.activeProfileId, firstSnapshot],
      [second.id, secondSnapshot],
    ])
    for (const [profileId, snapshot] of snapshots) {
      snapshots.set(profileId, clearSeasonBoundAllocations(snapshot))
    }

    expect(
      migrateBuildProfilesToSeason(build.id, 's9', snapshots)?.season,
    ).toBe('s9')
    for (const profileId of [build.activeProfileId, second.id]) {
      const migrated = loadProfileSnapshot(build.id, profileId)!
      expect(migrated.heroLevel).toBe(0)
      expect(migrated.allocatedTreeNodes.size).toBe(0)
      expect(migrated.allocatedEtherNodes.size).toBe(0)
    }
  })

  it('does not change the library when a profile snapshot is missing', () => {
    const build = createBuild('Profiles', makeSnapshot())

    expect(
      migrateBuildProfilesToSeason(build.id, 's9', new Map()),
    ).toBeNull()
    expect(getSavedBuild(build.id)?.season).toBe(activeSeasonId)
  })
})
