import { defaultEntityRates } from '../../utils/build/entityRates'
import type { StateCreator } from 'zustand'
import { activeSeasonId, classes } from '@data'
import {
  PENDING_BUILD_KEY,
  PENDING_IMPORT_KEY,
  reloadIntoSeason,
} from '@data/seasons/registry'
import { guardStorage } from '../storageError'
import { useSettings } from '../settings'
import { sanitizeHtml } from '../../utils/sanitizeHtml'
import {
  clearSeasonBoundAllocations,
  pruneUnknownIds,
} from '../../utils/build/seasonMigration'
import {
  addProfile as storeAddProfile,
  commitProfileSnapshot as storeCommitProfile,
  createBuild as storeCreateBuild,
  deleteBuild as storeDeleteBuild,
  duplicateBuild as storeDuplicateBuild,
  duplicateProfile as storeDuplicateProfile,
  getSavedBuild,
  loadProfileSnapshot,
  migrateBuildProfilesToSeason as storeMigrateBuildProfilesToSeason,
  moveBuildToFolder as storeMoveBuildToFolder,
  removeProfile as storeRemoveProfile,
  renameProfile as storeRenameProfile,
  renameBuild as storeRenameBuild,
  setActiveProfile as storeSetActiveProfile,
  setBuildFavorite as storeSetBuildFavorite,
  setBuildNotes as storeSetBuildNotes,
  setBuildStash as storeSetBuildStash,
  setBuildTags as storeSetBuildTags,
} from '../../utils/build/savedBuilds'
import type { Folder, SavedBuild } from '../../utils/build/savedBuilds'
import {
  createFolder as storeCreateFolder,
  deleteFolder as storeDeleteFolder,
  renameFolder as storeRenameFolder,
} from '../../utils/build/savedFolders'
import {
  decodeShareToBuild,
  defaultEnemyResistances,
  encodeBuildToShare,
} from '../../utils/build/shareBuild'
import { bumpSavedBuilds, emptyAllocation, snapshotPatch } from './helpers'
import {
  captureEtherLoadout,
  captureIncarnationLoadout,
  captureSpecLoadout,
  cloneEtherLoadout,
  cloneIncarnationLoadout,
  cloneSpecLoadout,
  createInitialLoadoutSlots,
  emptyEtherLoadout,
  emptyIncarnationLoadout,
  emptySpecLoadout,
  normalizeLoadoutSlots,
  syncActiveLoadout,
} from '../../utils/build/allocationLoadouts'
import type { BuildStore, SavedBuildProfilePatchResult } from './types'
import { withValidOffhand } from '../../utils/tree/dualWield'
import {
  heroLevelFor,
  incarnationNodeBudgetFor,
  sanitizeHeroLevel,
} from '../../utils/build/heroLevel'
import {
  DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER,
  sanitizeGearOptimizerRarityFilter,
  sanitizeGearOptimizerThresholds,
} from '../../types'

type SavedBuildsSlice = Pick<
  BuildStore,
  | 'activeBuildId'
  | 'activeProfileId'
  | 'savedBuildsVersion'
  | 'storageError'
  | 'notes'
  | 'customStats'
  | 'setNotes'
  | 'commitBuildNotes'
  | 'setCustomStats'
  | 'exportBuildSnapshot'
  | 'importBuildSnapshot'
  | 'importCodeToLibrary'
  | 'patchSavedBuildProfile'
  | 'detachFromBuild'
  | 'resetBuild'
  | 'loadSavedBuild'
  | 'changeActiveSeason'
  | 'switchActiveProfile'
  | 'commitActiveProfile'
  | 'saveBuildNow'
  | 'addProfileToActiveBuild'
  | 'duplicateActiveProfile'
  | 'renameActiveProfile'
  | 'removeActiveProfile'
  | 'deleteSavedBuild'
  | 'renameSavedBuild'
  | 'saveCurrentAsNewBuild'
  | 'duplicateSavedBuild'
  | 'setSavedBuildFavorite'
  | 'setSavedBuildTags'
  | 'moveSavedBuildToFolder'
  | 'switchSavedBuildProfile'
  | 'addSavedBuildProfile'
  | 'renameSavedBuildProfile'
  | 'duplicateSavedBuildProfile'
  | 'removeSavedBuildProfile'
  | 'createSavedFolder'
  | 'renameSavedFolder'
  | 'deleteSavedFolder'
  | 'dismissStorageError'
>

export const createSavedBuildsSlice: StateCreator<
  BuildStore,
  [],
  [],
  SavedBuildsSlice
> = (set, get) => ({
  activeBuildId: null,
  activeProfileId: null,
  savedBuildsVersion: 0,
  storageError: null,
  notes: '',
  customStats: [],

  setNotes: (html) =>
    set((s) => {
      const cleaned = sanitizeHtml(html)
      return s.notes === cleaned ? s : { notes: cleaned }
    }),

  commitBuildNotes: () =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const s = get()
        if (!s.activeBuildId) return false
        const ok = storeSetBuildNotes(s.activeBuildId, s.notes) !== null
        if (ok) bumpSavedBuilds(set)
        return ok
      },
    ),

  setCustomStats: (stats) => set({ customStats: stats }),

  exportBuildSnapshot: () => {
    const s = get()
    return {
      classId: s.classId,
      level: s.level,
      heroLevel: s.heroLevel,
      allocated: s.allocated,
      inventory: s.inventory,
      skillRanks: s.skillRanks,
      subskillRanks: s.subskillRanks,
      allocatedTreeNodes: s.allocatedTreeNodes,
      treeSocketed: s.treeSocketed,
      activeSkillIds: s.activeSkillIds,
      activeAuraId: s.activeAuraId,
      activeBuffs: s.activeBuffs,
      enemyConditions: s.enemyConditions,
      playerConditions: s.playerConditions,
      skillProjectiles: s.skillProjectiles,
      enemyResistances: s.enemyResistances,
      procToggles: s.procToggles,
      disabledPotions: s.disabledPotions,
      killsPerSec: s.killsPerSec,
      entityRates: s.entityRates,
      customStats: s.customStats,
      allocatedEtherNodes: s.allocatedEtherNodes,
      specLoadouts: syncActiveLoadout(
        s.specLoadouts,
        s.activeSpecLoadoutIndex,
        captureSpecLoadout(s),
        cloneSpecLoadout,
      ),
      activeSpecLoadoutIndex: s.activeSpecLoadoutIndex,
      incarnationLoadouts: syncActiveLoadout(
        s.incarnationLoadouts,
        s.activeIncarnationLoadoutIndex,
        captureIncarnationLoadout(s),
        cloneIncarnationLoadout,
      ),
      activeIncarnationLoadoutIndex: s.activeIncarnationLoadoutIndex,
      etherLoadouts: syncActiveLoadout(
        s.etherLoadouts,
        s.activeEtherLoadoutIndex,
        captureEtherLoadout(s),
        cloneEtherLoadout,
      ),
      activeEtherLoadoutIndex: s.activeEtherLoadoutIndex,
      mercClassId: s.mercClassId,
      mercSkillRanks: s.mercSkillRanks,
      mercInventory: s.mercInventory,
      mercDisabledAuras: s.mercDisabledAuras,
      gearOptimizerThresholds: sanitizeGearOptimizerThresholds(
        s.gearOptimizerThresholds,
      ),
      gearOptimizerRarityFilter: sanitizeGearOptimizerRarityFilter(
        s.gearOptimizerRarityFilter,
      ),
    }
  },

  importBuildSnapshot: (snapshot, notes = '') => {
    set(() => ({
      ...snapshotPatch(snapshot),
      notes,
      stash: [],
      activeBuildId: null,
      activeProfileId: null,
    }))
  },

  importCodeToLibrary: (code, name) => {
    const decoded = decodeShareToBuild(code)
    if (!decoded) return null
    return guardStorage<SavedBuild | null>(
      (m) => set({ storageError: m }),
      null,
      () => {
        const cls = classes.find((c) => c.id === decoded.snapshot.classId)
        const requestedName = name?.trim().slice(0, 500)
        const record = storeCreateBuild(
          requestedName || `Imported ${cls?.name ?? 'build'}`,
          decoded.snapshot,
          undefined,
          decoded.notes,
          null,
          decoded.season,
          [],
          code,
        )
        bumpSavedBuilds(set)
        return record
      },
    )
  },

  patchSavedBuildProfile: (
    buildId,
    profileId,
    patch,
    expectedSeason,
    expectedRevision,
  ) =>
    guardStorage<SavedBuildProfilePatchResult>(
      (m) => set({ storageError: m }),
      'rejected',
      () => {
        const targetBuild = getSavedBuild(buildId)
        const targetProfile = targetBuild?.profiles.find(
          (profile) => profile.id === profileId,
        )
        if (!targetBuild || !targetProfile) return 'rejected'
        if (
          targetBuild.activeProfileId !== profileId ||
          targetBuild.season !== expectedSeason ||
          expectedSeason !== activeSeasonId ||
          targetProfile.updatedAt !== expectedRevision
        ) {
          return 'conflict'
        }
        const current = get()
        const isActive =
          current.activeBuildId === buildId &&
          current.activeProfileId === profileId
        const rawBase = isActive
          ? current.exportBuildSnapshot()
          : loadProfileSnapshot(buildId, profileId)
        if (!rawBase) return 'rejected'
        const base = pruneUnknownIds(rawBase)

        const incarnationBank = normalizeLoadoutSlots(
          base.incarnationLoadouts,
          base.activeIncarnationLoadoutIndex,
          captureIncarnationLoadout(base),
          cloneIncarnationLoadout,
        )
        const etherBank = normalizeLoadoutSlots(
          base.etherLoadouts,
          base.activeEtherLoadoutIndex,
          captureEtherLoadout(base),
          cloneEtherLoadout,
        )
        for (const entry of patch.incarnationLoadouts ?? []) {
          if (
            !Number.isInteger(entry.index) ||
            entry.index < 0 ||
            entry.index >= incarnationBank.slots.length
          ) {
            return 'rejected'
          }
          if (!entry.loadout) {
            incarnationBank.slots[entry.index] = null
            continue
          }
          const nextLoadout = cloneIncarnationLoadout(entry.loadout)
          const previousLoadout = incarnationBank.slots[entry.index]
          if (previousLoadout) {
            const previousSockets = cloneIncarnationLoadout(previousLoadout).treeSocketed
            nextLoadout.treeSocketed = Object.fromEntries(
              Object.entries(previousSockets).filter(([nodeId]) =>
                nextLoadout.allocatedTreeNodes.has(Number(nodeId)),
              ),
            )
          }
          incarnationBank.slots[entry.index] = nextLoadout
        }
        for (const entry of patch.etherLoadouts ?? []) {
          if (
            !Number.isInteger(entry.index) ||
            entry.index < 0 ||
            entry.index >= etherBank.slots.length
          ) {
            return 'rejected'
          }
          etherBank.slots[entry.index] = entry.loadout
            ? cloneEtherLoadout(entry.loadout)
            : null
        }
        const activeIncarnationIndex =
          patch.activeIncarnationLoadoutIndex ?? incarnationBank.activeIndex
        const activeEtherIndex = patch.activeEtherLoadoutIndex ?? etherBank.activeIndex
        if (
          !Number.isInteger(activeIncarnationIndex) ||
          activeIncarnationIndex < 0 ||
          activeIncarnationIndex >= incarnationBank.slots.length ||
          !Number.isInteger(activeEtherIndex) ||
          activeEtherIndex < 0 ||
          activeEtherIndex >= etherBank.slots.length
        ) {
          return 'rejected'
        }
        const activeIncarnation = incarnationBank.slots[activeIncarnationIndex]
        const activeEther = etherBank.slots[activeEtherIndex]
        if (!activeIncarnation || !activeEther) return 'rejected'
        const incarnationBudget = incarnationNodeBudgetFor(
          base.heroLevel === undefined
            ? heroLevelFor(base)
            : sanitizeHeroLevel(base.heroLevel),
        )
        if (
          incarnationBank.slots.some(
            (loadout) =>
              loadout != null &&
              loadout.allocatedTreeNodes.size > incarnationBudget,
          )
        ) {
          return 'rejected'
        }

        const merged = {
          ...base,
          allocatedTreeNodes: new Set(activeIncarnation.allocatedTreeNodes),
          treeSocketed: cloneIncarnationLoadout(activeIncarnation).treeSocketed,
          inventory: withValidOffhand(
            base.inventory,
            activeIncarnation.allocatedTreeNodes,
          ),
          allocatedEtherNodes: new Set(activeEther.allocatedEtherNodes),
          incarnationLoadouts: incarnationBank.slots,
          activeIncarnationLoadoutIndex: activeIncarnationIndex,
          etherLoadouts: etherBank.slots,
          activeEtherLoadoutIndex: activeEtherIndex,
          ...('mercClassId' in patch
            ? {
                mercClassId: patch.mercClassId ?? null,
                mercSkillRanks: { ...(patch.mercSkillRanks ?? {}) },
              }
            : {}),
        }
        const result = storeCommitProfile(buildId, profileId, merged)
        if (!result) return 'rejected'
        if (isActive) {
          set((state) => ({
            ...snapshotPatch(merged),
            savedBuildsVersion: state.savedBuildsVersion + 1,
          }))
        } else {
          bumpSavedBuilds(set)
        }
        return 'applied'
      },
    ),

  detachFromBuild: () =>
    set(() => ({ activeBuildId: null, activeProfileId: null })),

  resetBuild: () =>
    set(() => ({
      classId: classes[0]?.id ?? null,
      level: 1,
      heroLevel: 0,
      allocated: emptyAllocation(),
      inventory: {},
      skillRanks: {},
      allocatedTreeNodes: new Set<number>(),
      treeSocketed: {},
      activeSkillIds: [],
      activeAuraId: null,
      procToggles: {},
      disabledPotions: {},
      killsPerSec: 1,
      entityRates: defaultEntityRates(),
      activeBuffs: {},
      enemyConditions: {},
      playerConditions: {},
      skillProjectiles: {},
      enemyResistances: defaultEnemyResistances(),
      subskillRanks: {},
      allocatedEtherNodes: new Set<number>(),
      specLoadouts: createInitialLoadoutSlots(
        emptySpecLoadout(),
        cloneSpecLoadout,
      ),
      activeSpecLoadoutIndex: 0,
      incarnationLoadouts: createInitialLoadoutSlots(
        emptyIncarnationLoadout(),
        cloneIncarnationLoadout,
      ),
      activeIncarnationLoadoutIndex: 0,
      etherLoadouts: createInitialLoadoutSlots(
        emptyEtherLoadout(),
        cloneEtherLoadout,
      ),
      activeEtherLoadoutIndex: 0,
      mercClassId: null,
      mercSkillRanks: {},
      mercInventory: {},
      mercDisabledAuras: {},
      activeBuildId: null,
      activeProfileId: null,
      notes: '',
      customStats: [],
      stash: [],
      gearOptimizerThresholds: {},
      gearOptimizerRarityFilter: {
        ...DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER,
      },
    })),

  deleteSavedBuild: (buildId) =>
    guardStorage<void>(
      (m) => set({ storageError: m }),
      undefined,
      () => {
        storeDeleteBuild(buildId)
        set((cur) => {
          const detach = cur.activeBuildId === buildId
          return {
            savedBuildsVersion: cur.savedBuildsVersion + 1,
            ...(detach
              ? { activeBuildId: null, activeProfileId: null }
              : {}),
          }
        })
      },
    ),

  renameSavedBuild: (buildId, name) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const ok = storeRenameBuild(buildId, name) !== null
        if (ok) bumpSavedBuilds(set)
        return ok
      },
    ),

  commitActiveProfile: () =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const s = get()
        if (!s.activeBuildId || !s.activeProfileId) return false
        const snap = s.exportBuildSnapshot()
        const result = storeCommitProfile(
          s.activeBuildId,
          s.activeProfileId,
          snap,
        )
        if (result) bumpSavedBuilds(set)
        return result !== null
      },
    ),

  saveBuildNow: () => {
    const s = get()
    if (!s.activeBuildId || !s.activeProfileId) return false
    const ok = s.commitActiveProfile()
    s.commitBuildNotes()
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => storeSetBuildStash(s.activeBuildId!, get().stash) !== null,
    )
    return ok
  },

  loadSavedBuild: (buildId, profileId) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const cur = get()
        if (
          useSettings.getState().autoSave &&
          cur.activeBuildId &&
          cur.activeProfileId
        ) {
          storeCommitProfile(
            cur.activeBuildId,
            cur.activeProfileId,
            cur.exportBuildSnapshot(),
          )
        }
        const build = getSavedBuild(buildId)
        if (!build) return false
        if (reloadIntoSeason(build.season, PENDING_BUILD_KEY, buildId, activeSeasonId)) {
          return true
        }
        const targetProfileId =
          profileId && build.profiles.some((p) => p.id === profileId)
            ? profileId
            : build.activeProfileId
        const snap = loadProfileSnapshot(buildId, targetProfileId)
        if (!snap) return false
        storeSetActiveProfile(buildId, targetProfileId)
        set((s) => ({
          ...snapshotPatch(snap),
          notes: sanitizeHtml(build.notes ?? ''),
          stash: build.stash,
          activeBuildId: buildId,
          activeProfileId: targetProfileId,
          savedBuildsVersion: s.savedBuildsVersion + 1,
        }))
        return true
      },
    ),

  changeActiveSeason: (season) =>
    guardStorage(
      (m) => set({ storageError: m }),
      undefined,
      () => {
        const s = get()
        const snap = clearSeasonBoundAllocations(s.exportBuildSnapshot())
        if (s.activeBuildId && s.activeProfileId) {
          const build = getSavedBuild(s.activeBuildId)
          if (!build) return
          const migratedProfiles = new Map<string, ReturnType<typeof s.exportBuildSnapshot>>()
          for (const profile of build.profiles) {
            const profileSnapshot =
              profile.id === s.activeProfileId
                ? snap
                : loadProfileSnapshot(build.id, profile.id)
            if (!profileSnapshot) return
            migratedProfiles.set(
              profile.id,
              profile.id === s.activeProfileId
                ? profileSnapshot
                : clearSeasonBoundAllocations(profileSnapshot),
            )
          }
          if (
            !storeMigrateBuildProfilesToSeason(
              s.activeBuildId,
              season,
              migratedProfiles,
            )
          ) {
            return
          }
          reloadIntoSeason(
            season,
            PENDING_BUILD_KEY,
            s.activeBuildId,
            activeSeasonId,
          )
        } else {
          const code = encodeBuildToShare(snap, s.notes)
          reloadIntoSeason(season, PENDING_IMPORT_KEY, code, activeSeasonId)
        }
      },
    ),

  switchActiveProfile: (profileId) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const s = get()
        if (!s.activeBuildId) return false
        if (s.activeProfileId === profileId) return true
        if (s.activeProfileId && useSettings.getState().autoSave) {
          storeCommitProfile(
            s.activeBuildId,
            s.activeProfileId,
            s.exportBuildSnapshot(),
          )
        }
        const snap = loadProfileSnapshot(s.activeBuildId, profileId)
        if (!snap) return false
        storeSetActiveProfile(s.activeBuildId, profileId)
        set((cur) => ({
          ...snapshotPatch(snap),
          activeProfileId: profileId,
          savedBuildsVersion: cur.savedBuildsVersion + 1,
        }))
        return true
      },
    ),

  addProfileToActiveBuild: (name) =>
    guardStorage<string | null>(
      (m) => set({ storageError: m }),
      null,
      () => {
        const s = get()
        if (!s.activeBuildId) return null
        if (s.activeProfileId && useSettings.getState().autoSave) {
          storeCommitProfile(
            s.activeBuildId,
            s.activeProfileId,
            s.exportBuildSnapshot(),
          )
        }
        const result = storeAddProfile(
          s.activeBuildId,
          name,
          s.exportBuildSnapshot(),
          { activate: true },
        )
        if (!result) return null
        set((cur) => ({
          activeProfileId: result.profile.id,
          savedBuildsVersion: cur.savedBuildsVersion + 1,
        }))
        return result.profile.id
      },
    ),

  duplicateActiveProfile: (profileId) =>
    guardStorage<string | null>(
      (m) => set({ storageError: m }),
      null,
      () => {
        const s = get()
        if (!s.activeBuildId) return null
        if (s.activeProfileId && useSettings.getState().autoSave) {
          storeCommitProfile(
            s.activeBuildId,
            s.activeProfileId,
            s.exportBuildSnapshot(),
          )
        }
        const result = storeDuplicateProfile(s.activeBuildId, profileId)
        if (!result) return null
        const snap = loadProfileSnapshot(s.activeBuildId, result.profile.id)
        if (snap) {
          set((cur) => ({
            ...snapshotPatch(snap),
            activeProfileId: result.profile.id,
            savedBuildsVersion: cur.savedBuildsVersion + 1,
          }))
        } else {
          bumpSavedBuilds(set)
        }
        return result.profile.id
      },
    ),

  renameActiveProfile: (profileId, name) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const s = get()
        if (!s.activeBuildId) return false
        const ok = storeRenameProfile(s.activeBuildId, profileId, name) !== null
        if (ok) bumpSavedBuilds(set)
        return ok
      },
    ),

  removeActiveProfile: (profileId) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const s = get()
        if (!s.activeBuildId) return false
        const isActive = s.activeProfileId === profileId
        const updated = storeRemoveProfile(s.activeBuildId, profileId)
        if (!updated) return false
        if (isActive) {
          const snap = loadProfileSnapshot(
            s.activeBuildId,
            updated.activeProfileId,
          )
          if (snap) {
            set((cur) => ({
              ...snapshotPatch(snap),
              activeProfileId: updated.activeProfileId,
              savedBuildsVersion: cur.savedBuildsVersion + 1,
            }))
          } else {
            bumpSavedBuilds(set)
          }
        } else {
          bumpSavedBuilds(set)
        }
        return true
      },
    ),

  dismissStorageError: () => set({ storageError: null }),

  saveCurrentAsNewBuild: (name, notes = '', folderId = null) =>
    guardStorage<SavedBuild | null>(
      (m) => set({ storageError: m }),
      null,
      () => {
        const snapshot = get().exportBuildSnapshot()
        const record = storeCreateBuild(
          name,
          snapshot,
          undefined,
          notes,
          folderId,
          activeSeasonId,
          get().stash,
        )
        set((cur) => ({
          activeBuildId: record.id,
          activeProfileId: record.activeProfileId,
          savedBuildsVersion: cur.savedBuildsVersion + 1,
        }))
        return record
      },
    ),

  duplicateSavedBuild: (buildId) =>
    guardStorage<SavedBuild | null>(
      (m) => set({ storageError: m }),
      null,
      () => {
        const record = storeDuplicateBuild(buildId)
        if (record) bumpSavedBuilds(set)
        return record
      },
    ),

  setSavedBuildFavorite: (buildId, favorite) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const ok = storeSetBuildFavorite(buildId, favorite) !== null
        if (ok) bumpSavedBuilds(set)
        return ok
      },
    ),

  setSavedBuildTags: (buildId, tags) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const ok = storeSetBuildTags(buildId, tags) !== null
        if (ok) bumpSavedBuilds(set)
        return ok
      },
    ),

  moveSavedBuildToFolder: (buildId, folderId) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const ok = storeMoveBuildToFolder(buildId, folderId) !== null
        if (ok) bumpSavedBuilds(set)
        return ok
      },
    ),

  switchSavedBuildProfile: (buildId, profileId) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const s = get()
        if (buildId === s.activeBuildId) return s.switchActiveProfile(profileId)
        const ok = storeSetActiveProfile(buildId, profileId) !== null
        if (ok) bumpSavedBuilds(set)
        return ok
      },
    ),

  addSavedBuildProfile: (buildId, name) =>
    guardStorage<string | null>(
      (m) => set({ storageError: m }),
      null,
      () => {
        const s = get()
        if (
          buildId === s.activeBuildId &&
          s.activeProfileId &&
          useSettings.getState().autoSave
        ) {
          storeCommitProfile(buildId, s.activeProfileId, s.exportBuildSnapshot())
        }
        const build = getSavedBuild(buildId)
        if (!build) return null
        const seed = loadProfileSnapshot(buildId, build.activeProfileId)
        if (!seed) return null
        const result = storeAddProfile(buildId, name, seed, {
          activate: false,
        })
        if (!result) return null
        bumpSavedBuilds(set)
        return result.profile.id
      },
    ),

  renameSavedBuildProfile: (buildId, profileId, name) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const ok = storeRenameProfile(buildId, profileId, name) !== null
        if (ok) bumpSavedBuilds(set)
        return ok
      },
    ),

  duplicateSavedBuildProfile: (buildId, profileId) =>
    guardStorage<string | null>(
      (m) => set({ storageError: m }),
      null,
      () => {
        const result = storeDuplicateProfile(buildId, profileId, {
          activate: false,
        })
        if (!result) return null
        bumpSavedBuilds(set)
        return result.profile.id
      },
    ),

  removeSavedBuildProfile: (buildId, profileId) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const s = get()
        if (buildId === s.activeBuildId) return s.removeActiveProfile(profileId)
        const ok = storeRemoveProfile(buildId, profileId) !== null
        if (ok) bumpSavedBuilds(set)
        return ok
      },
    ),

  createSavedFolder: (name, parentId) =>
    guardStorage<Folder | null>(
      (m) => set({ storageError: m }),
      null,
      () => {
        const folder = storeCreateFolder(name, parentId)
        bumpSavedBuilds(set)
        return folder
      },
    ),

  renameSavedFolder: (folderId, name) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        const ok = storeRenameFolder(folderId, name) !== null
        if (ok) bumpSavedBuilds(set)
        return ok
      },
    ),

  deleteSavedFolder: (folderId, cascade) =>
    guardStorage(
      (m) => set({ storageError: m }),
      false,
      () => {
        storeDeleteFolder(folderId, { cascade })
        bumpSavedBuilds(set)
        return true
      },
    ),
})
