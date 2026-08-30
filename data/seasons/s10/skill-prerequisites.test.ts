import { describe, expect, it } from 'vitest'
import type { Skill } from '../../../frontend/types'
import {
  activeSeasonId,
  skills,
  type SkillPrerequisiteMap,
} from '../../index'
import prerequisitesJson from './skill-prerequisites.json'

const prerequisites = prerequisitesJson as SkillPrerequisiteMap
const entries = Object.entries(prerequisites)
const skillById = new Map(skills.map((skill) => [skill.id, skill]))

function treeKey(skill: Skill): string {
  return `${skill.classId}\0${skill.tree ?? ''}`
}

function prerequisiteCycles(): string[] {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const cycles: string[] = []

  const visit = (skillId: string, path: string[]) => {
    if (visiting.has(skillId)) {
      cycles.push([...path, skillId].join(' -> '))
      return
    }
    if (visited.has(skillId)) return

    visiting.add(skillId)
    for (const parentId of prerequisites[skillId] ?? []) {
      visit(parentId, [...path, skillId])
    }
    visiting.delete(skillId)
    visited.add(skillId)
  }

  for (const [skillId] of entries) visit(skillId, [])
  return cycles
}

describe('Season 10 skill prerequisites', () => {
  it('targets the active Season 10 skill data', () => {
    expect(activeSeasonId).toBe('s10')
    expect(new Set(skills.map((skill) => skill.classId))).toHaveLength(24)
    expect(new Set(skills.map(treeKey))).toHaveLength(48)
  })

  it('references existing skills in the same class and tree', () => {
    for (const [childId, parentIds] of entries) {
      const child = skillById.get(childId)
      expect(child, `unknown prerequisite child ${childId}`).toBeDefined()

      for (const parentId of parentIds) {
        const parent = skillById.get(parentId)
        expect(
          parent,
          `${childId} references unknown prerequisite ${parentId}`,
        ).toBeDefined()
        expect(parent!.classId, `${childId} -> ${parentId} crosses classes`).toBe(
          child!.classId,
        )
        expect(parent!.tree, `${childId} -> ${parentId} crosses trees`).toBe(
          child!.tree,
        )
      }
    }
  })

  it('has non-empty, duplicate-free edge lists without self dependencies', () => {
    for (const [childId, parentIds] of entries) {
      expect(parentIds, `${childId} prerequisites must be an array`).toBeInstanceOf(
        Array,
      )
      expect(parentIds.length, `${childId} has an empty prerequisite list`).toBeGreaterThan(
        0,
      )
      expect(
        new Set(parentIds).size,
        `${childId} repeats a prerequisite`,
      ).toBe(parentIds.length)
      expect(parentIds, `${childId} depends on itself`).not.toContain(childId)
    }
  })

  it('never requires a skill from a later level', () => {
    for (const [childId, parentIds] of entries) {
      const child = skillById.get(childId)!
      const childLevel = child.requiresLevel ?? 1
      for (const parentId of parentIds) {
        const parent = skillById.get(parentId)!
        expect(
          parent.requiresLevel ?? 1,
          `${childId} (level ${childLevel}) requires later skill ${parentId} (level ${parent.requiresLevel ?? 1})`,
        ).toBeLessThanOrEqual(childLevel)
      }
    }
  })

  it('forms an acyclic prerequisite graph', () => {
    expect(prerequisiteCycles()).toEqual([])
  })

  it('is applied exactly to the active Season 10 skills', () => {
    for (const skill of skills) {
      expect(skill.requiresAllOf, `prerequisites for ${skill.id}`).toEqual(
        prerequisites[skill.id],
      )
    }
  })

  it('does not treat the horizontal Butcher Hook line as a requirement', () => {
    expect(prerequisites.chain_swing).toBeUndefined()
    expect(skillById.get('chain_swing')?.requiresAllOf).toBeUndefined()
  })

  it('matches the complete in-game Son of Ymir layout and connectors', () => {
    const positions = {
      frozen_boulder: { row: 0, col: 0 },
      breath_of_ice: { row: 0, col: 2 },
      icicles: { row: 1, col: 0 },
      frozen_hide: { row: 1, col: 1 },
      orb_of_frost: { row: 2, col: 1 },
      power_of_the_ancients: { row: 2, col: 2 },
      portal_of_ice: { row: 3, col: 0 },
      avatar_of_frost: { row: 3, col: 2 },
      blizzard: { row: 4, col: 1 },
    }

    for (const [skillId, position] of Object.entries(positions)) {
      expect(skillById.get(skillId)?.position, skillId).toEqual(position)
    }

    expect(prerequisites.icicles).toEqual(['frozen_boulder'])
    expect(prerequisites.frozen_hide).toEqual(['breath_of_ice'])
    expect(prerequisites.orb_of_frost).toEqual(['icicles'])
    expect(prerequisites.portal_of_ice).toEqual(['icicles'])
    expect(prerequisites.avatar_of_frost).toEqual(['power_of_the_ancients'])
    expect(prerequisites.blizzard).toEqual(['orb_of_frost'])
    expect(prerequisites.power_of_the_ancients).toBeUndefined()
  })

  it('covers all 24 classes and all 48 class-specific trees', () => {
    const mappedSkills = entries.map(([childId]) => skillById.get(childId)!)
    const allClassIds = new Set(skills.map((skill) => skill.classId))
    const allTreeKeys = new Set(skills.map(treeKey))

    expect(new Set(mappedSkills.map((skill) => skill.classId))).toEqual(
      allClassIds,
    )
    expect(new Set(mappedSkills.map(treeKey))).toEqual(allTreeKeys)
  })

  it('matches the complete current-game availability dataset', () => {
    expect(entries).toHaveLength(264)
    expect(entries.reduce((count, [, parents]) => count + parents.length, 0)).toBe(
      277,
    )
    expect(entries.filter(([, parents]) => parents.length > 1)).toHaveLength(13)
  })
})
