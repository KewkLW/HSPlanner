import type { StateCreator } from 'zustand'
import {
  DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER,
  isGearOptimizerRarityFilter,
  isGearOptimizerThresholdId,
  isGearOptimizerThresholdValue,
  sanitizeGearOptimizerThresholds,
} from '../../types'
import type { BuildStore } from './types'

type OptimizerSlice = Pick<
  BuildStore,
  | 'gearOptimizerThresholds'
  | 'gearOptimizerRarityFilter'
  | 'setGearOptimizerThreshold'
  | 'clearGearOptimizerThresholds'
  | 'setGearOptimizerRarityFilter'
>

export const createOptimizerSlice: StateCreator<
  BuildStore,
  [],
  [],
  OptimizerSlice
> = (set) => ({
  gearOptimizerThresholds: {},
  gearOptimizerRarityFilter: { ...DEFAULT_GEAR_OPTIMIZER_RARITY_FILTER },

  setGearOptimizerThreshold: (statKey, minimum) =>
    set((state) => {
      if (!isGearOptimizerThresholdId(statKey)) return state
      const next = sanitizeGearOptimizerThresholds(
        state.gearOptimizerThresholds,
      )
      if (minimum === null) {
        if (!(statKey in next)) return state
        delete next[statKey]
      } else if (isGearOptimizerThresholdValue(minimum)) {
        if (next[statKey] === minimum) return state
        next[statKey] = minimum
      } else {
        return state
      }
      return { gearOptimizerThresholds: next }
    }),

  clearGearOptimizerThresholds: () => set({ gearOptimizerThresholds: {} }),

  setGearOptimizerRarityFilter: (filter) =>
    set((state) => {
      if (!isGearOptimizerRarityFilter(filter)) return state
      if (
        state.gearOptimizerRarityFilter.mode === filter.mode &&
        state.gearOptimizerRarityFilter.rarity === filter.rarity
      ) {
        return state
      }
      return { gearOptimizerRarityFilter: { ...filter } }
    }),
})
