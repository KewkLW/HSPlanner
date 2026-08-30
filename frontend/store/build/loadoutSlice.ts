import type { StateCreator } from 'zustand'
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
  etherLoadoutPatch,
  incarnationLoadoutPatch,
  isLoadoutSlotIndex,
  specLoadoutPatch,
} from '../../utils/build/allocationLoadouts'
import type { BuildStore } from './types'
import { withValidOffhand } from '../../utils/tree/dualWield'

type LoadoutSlice = Pick<
  BuildStore,
  | 'specLoadouts'
  | 'activeSpecLoadoutIndex'
  | 'incarnationLoadouts'
  | 'activeIncarnationLoadoutIndex'
  | 'etherLoadouts'
  | 'activeEtherLoadoutIndex'
  | 'allocationLoadoutNavigationVersion'
  | 'createSpecLoadout'
  | 'switchSpecLoadout'
  | 'createIncarnationLoadout'
  | 'switchIncarnationLoadout'
  | 'createEtherLoadout'
  | 'switchEtherLoadout'
>

export const createLoadoutSlice: StateCreator<
  BuildStore,
  [],
  [],
  LoadoutSlice
> = (set) => ({
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
  allocationLoadoutNavigationVersion: 0,

  createSpecLoadout: (index) =>
    set((state) => {
      if (!isLoadoutSlotIndex(index) || state.specLoadouts[index] != null) {
        return state
      }
      const next = [...state.specLoadouts]
      next[state.activeSpecLoadoutIndex] = captureSpecLoadout(state)
      const blank = emptySpecLoadout()
      next[index] = cloneSpecLoadout(blank)
      return {
        ...specLoadoutPatch(blank),
        specLoadouts: next,
        activeSpecLoadoutIndex: index,
        allocationLoadoutNavigationVersion:
          state.allocationLoadoutNavigationVersion + 1,
      }
    }),

  switchSpecLoadout: (index) =>
    set((state) => {
      const target = state.specLoadouts[index]
      if (
        !isLoadoutSlotIndex(index) ||
        index === state.activeSpecLoadoutIndex ||
        target == null
      ) {
        return state
      }
      const next = [...state.specLoadouts]
      next[state.activeSpecLoadoutIndex] = captureSpecLoadout(state)
      return {
        ...specLoadoutPatch(target),
        specLoadouts: next,
        activeSpecLoadoutIndex: index,
        allocationLoadoutNavigationVersion:
          state.allocationLoadoutNavigationVersion + 1,
      }
    }),

  createIncarnationLoadout: (index) =>
    set((state) => {
      if (
        !isLoadoutSlotIndex(index) ||
        state.incarnationLoadouts[index] != null
      ) {
        return state
      }
      const next = [...state.incarnationLoadouts]
      next[state.activeIncarnationLoadoutIndex] =
        captureIncarnationLoadout(state)
      const blank = emptyIncarnationLoadout()
      next[index] = cloneIncarnationLoadout(blank)
      return {
        ...incarnationLoadoutPatch(blank),
        inventory: withValidOffhand(
          state.inventory,
          blank.allocatedTreeNodes,
        ),
        incarnationLoadouts: next,
        activeIncarnationLoadoutIndex: index,
        allocationLoadoutNavigationVersion:
          state.allocationLoadoutNavigationVersion + 1,
      }
    }),

  switchIncarnationLoadout: (index) =>
    set((state) => {
      const target = state.incarnationLoadouts[index]
      if (
        !isLoadoutSlotIndex(index) ||
        index === state.activeIncarnationLoadoutIndex ||
        target == null
      ) {
        return state
      }
      const next = [...state.incarnationLoadouts]
      next[state.activeIncarnationLoadoutIndex] =
        captureIncarnationLoadout(state)
      return {
        ...incarnationLoadoutPatch(target),
        inventory: withValidOffhand(
          state.inventory,
          target.allocatedTreeNodes,
        ),
        incarnationLoadouts: next,
        activeIncarnationLoadoutIndex: index,
        allocationLoadoutNavigationVersion:
          state.allocationLoadoutNavigationVersion + 1,
      }
    }),

  createEtherLoadout: (index) =>
    set((state) => {
      if (!isLoadoutSlotIndex(index) || state.etherLoadouts[index] != null) {
        return state
      }
      const next = [...state.etherLoadouts]
      next[state.activeEtherLoadoutIndex] = captureEtherLoadout(state)
      const blank = emptyEtherLoadout()
      next[index] = cloneEtherLoadout(blank)
      return {
        ...etherLoadoutPatch(blank),
        etherLoadouts: next,
        activeEtherLoadoutIndex: index,
        allocationLoadoutNavigationVersion:
          state.allocationLoadoutNavigationVersion + 1,
      }
    }),

  switchEtherLoadout: (index) =>
    set((state) => {
      const target = state.etherLoadouts[index]
      if (
        !isLoadoutSlotIndex(index) ||
        index === state.activeEtherLoadoutIndex ||
        target == null
      ) {
        return state
      }
      const next = [...state.etherLoadouts]
      next[state.activeEtherLoadoutIndex] = captureEtherLoadout(state)
      return {
        ...etherLoadoutPatch(target),
        etherLoadouts: next,
        activeEtherLoadoutIndex: index,
        allocationLoadoutNavigationVersion:
          state.allocationLoadoutNavigationVersion + 1,
      }
    }),
})
