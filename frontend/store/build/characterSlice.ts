import type { StateCreator } from 'zustand'
import { classes, gameConfig } from '@data'
import { attrPointsFor, emptyAllocation } from './helpers'
import {
  maxAllocatedIncarnationNodes,
  sanitizeHeroLevel,
} from '../../utils/build/heroLevel'
import {
  cloneSpecLoadout,
  createInitialLoadoutSlots,
  emptySpecLoadout,
} from '../../utils/build/allocationLoadouts'
import type { BuildStore } from './types'

type CharacterSlice = Pick<
  BuildStore,
  | 'classId'
  | 'level'
  | 'heroLevel'
  | 'allocated'
  | 'setClass'
  | 'setLevel'
  | 'setHeroLevel'
  | 'incAttr'
  | 'decAttr'
  | 'resetAttrs'
>

export const createCharacterSlice: StateCreator<
  BuildStore,
  [],
  [],
  CharacterSlice
> = (set, get) => ({
  classId: classes[0]?.id ?? null,
  level: 1,
  heroLevel: 0,
  allocated: emptyAllocation(),

  // class-bound state resets, but the saved-build binding (and its notes) must survive
  setClass: (id) =>
    set((s) => {
      if (s.classId === id) return s
      return {
        classId: id,
        allocated: emptyAllocation(),
        skillRanks: {},
        activeSkillIds: [],
        activeAuraId: null,
        procToggles: {},
        activeBuffs: {},
        subskillRanks: {},
        treeSocketed: {},
        skillProjectiles: {},
        specLoadouts: createInitialLoadoutSlots(
          emptySpecLoadout(),
          cloneSpecLoadout,
        ),
        activeSpecLoadoutIndex: 0,
        incarnationLoadouts: s.incarnationLoadouts.map((loadout) =>
          loadout == null
            ? null
            : { ...loadout, treeSocketed: {} },
        ),
      }
    }),

  setLevel: (lvl) => {
    const clamped = Math.max(1, Math.min(gameConfig.maxCharacterLevel, lvl))
    set({ level: clamped })
  },

  setHeroLevel: (lvl) =>
    set((state) => ({
      // Hero Level only rises in-game. Do not let an edit silently make an
      // occupied alternate Incarnation loadout illegal; reset those nodes
      // first when a lower planning level is desired.
      heroLevel: Math.max(
        sanitizeHeroLevel(lvl),
        maxAllocatedIncarnationNodes(state),
      ),
    })),

  incAttr: (key, amount = 1) => {
    const { allocated, level } = get()
    const total = Object.values(allocated).reduce((s, v) => s + v, 0)
    const available = attrPointsFor(level) - total
    const step = Math.min(amount, available)
    if (step <= 0) return
    set({ allocated: { ...allocated, [key]: (allocated[key] ?? 0) + step } })
  },

  decAttr: (key, amount = 1) => {
    const { allocated } = get()
    const cur = allocated[key] ?? 0
    const step = Math.min(amount, cur)
    if (step <= 0) return
    set({ allocated: { ...allocated, [key]: cur - step } })
  },

  resetAttrs: () => set({ allocated: emptyAllocation() }),
})
