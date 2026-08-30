import { gameConfig } from '@data'
import type {
  AttributeKey,
  EtherLoadout,
  IncarnationLoadout,
  LoadoutSlots,
  SpecLoadout,
  TreeSocketContent,
} from '../../types'
import { ALLOCATION_LOADOUT_SLOT_COUNT } from '../../types'

interface SpecStateLike {
  allocated: Record<AttributeKey, number>
  skillRanks: Record<string, number>
  subskillRanks: Record<string, number>
  activeSkillIds: string[]
  activeAuraId: string | null
}

interface IncarnationStateLike {
  allocatedTreeNodes: Set<number>
  treeSocketed: Record<number, TreeSocketContent | null>
}

interface EtherStateLike {
  allocatedEtherNodes: Set<number>
}

function emptyAllocatedAttributes(): Record<AttributeKey, number> {
  return Object.fromEntries(
    gameConfig.attributes.map((attribute) => [attribute.key, 0]),
  )
}

function cloneTreeSocketContent(
  content: TreeSocketContent | null,
): TreeSocketContent | null {
  if (content == null) return null
  if (content.kind === 'item') return { ...content }
  return {
    ...content,
    affixes: content.affixes.map((affix) => ({ ...affix })),
  }
}

function cloneTreeSocketed(
  socketed: Record<number, TreeSocketContent | null>,
): Record<number, TreeSocketContent | null> {
  return Object.fromEntries(
    Object.entries(socketed).map(([nodeId, content]) => [
      Number(nodeId),
      cloneTreeSocketContent(content),
    ]),
  )
}

export function emptySpecLoadout(): SpecLoadout {
  return {
    allocated: emptyAllocatedAttributes(),
    skillRanks: {},
    subskillRanks: {},
    activeSkillIds: [],
    activeAuraId: null,
  }
}

export function emptyIncarnationLoadout(): IncarnationLoadout {
  return {
    allocatedTreeNodes: new Set<number>(),
    treeSocketed: {},
  }
}

export function emptyEtherLoadout(): EtherLoadout {
  return { allocatedEtherNodes: new Set<number>() }
}

export function cloneSpecLoadout(loadout: SpecLoadout): SpecLoadout {
  return {
    allocated: { ...loadout.allocated },
    skillRanks: { ...loadout.skillRanks },
    subskillRanks: { ...loadout.subskillRanks },
    activeSkillIds: [...loadout.activeSkillIds],
    activeAuraId: loadout.activeAuraId,
  }
}

export function cloneIncarnationLoadout(
  loadout: IncarnationLoadout,
): IncarnationLoadout {
  return {
    allocatedTreeNodes: new Set(loadout.allocatedTreeNodes),
    treeSocketed: cloneTreeSocketed(loadout.treeSocketed),
  }
}

export function cloneEtherLoadout(loadout: EtherLoadout): EtherLoadout {
  return { allocatedEtherNodes: new Set(loadout.allocatedEtherNodes) }
}

export function captureSpecLoadout(state: SpecStateLike): SpecLoadout {
  return cloneSpecLoadout(state)
}

export function captureIncarnationLoadout(
  state: IncarnationStateLike,
): IncarnationLoadout {
  return cloneIncarnationLoadout(state)
}

export function captureEtherLoadout(state: EtherStateLike): EtherLoadout {
  return cloneEtherLoadout(state)
}

export function specLoadoutPatch(loadout: SpecLoadout): SpecLoadout {
  return cloneSpecLoadout(loadout)
}

export function incarnationLoadoutPatch(
  loadout: IncarnationLoadout,
): IncarnationLoadout {
  return cloneIncarnationLoadout(loadout)
}

export function etherLoadoutPatch(loadout: EtherLoadout): EtherLoadout {
  return cloneEtherLoadout(loadout)
}

export function createInitialLoadoutSlots<T>(
  initial: T,
  clone: (loadout: T) => T,
): LoadoutSlots<T> {
  const slots = new Array<T | null>(ALLOCATION_LOADOUT_SLOT_COUNT).fill(null)
  slots[0] = clone(initial)
  return slots
}

function validActiveIndex(index: unknown): number {
  return Number.isInteger(index) &&
    (index as number) >= 0 &&
    (index as number) < ALLOCATION_LOADOUT_SLOT_COUNT
    ? (index as number)
    : 0
}

export function normalizeLoadoutSlots<T>(
  rawSlots: readonly (T | null)[] | undefined,
  rawActiveIndex: number | undefined,
  activeLoadout: T,
  clone: (loadout: T) => T,
): { slots: LoadoutSlots<T>; activeIndex: number } {
  const activeIndex = rawSlots ? validActiveIndex(rawActiveIndex) : 0
  const slots = new Array<T | null>(ALLOCATION_LOADOUT_SLOT_COUNT).fill(null)
  for (let index = 0; index < ALLOCATION_LOADOUT_SLOT_COUNT; index += 1) {
    const entry = rawSlots?.[index]
    slots[index] = entry == null ? null : clone(entry)
  }

  // The existing top-level snapshot fields remain authoritative for the active
  // combination, which keeps old share codes and clients fully compatible.
  slots[activeIndex] = clone(activeLoadout)
  return { slots, activeIndex }
}

export function syncActiveLoadout<T>(
  slots: readonly (T | null)[],
  activeIndex: number,
  activeLoadout: T,
  clone: (loadout: T) => T,
): LoadoutSlots<T> {
  return normalizeLoadoutSlots(slots, activeIndex, activeLoadout, clone).slots
}

export function isLoadoutSlotIndex(index: number): boolean {
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < ALLOCATION_LOADOUT_SLOT_COUNT
  )
}
