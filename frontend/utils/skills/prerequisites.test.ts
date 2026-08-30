import { describe, expect, it } from 'vitest'
import {
  skillPrerequisiteIds,
  unmetSkillPrerequisiteIds,
} from './prerequisites'

describe('skill prerequisites', () => {
  it('requires every requiresAllOf entry', () => {
    const skill = { requiresAllOf: ['left', 'right'] }

    expect(unmetSkillPrerequisiteIds(skill, {})).toEqual(['left', 'right'])
    expect(unmetSkillPrerequisiteIds(skill, { left: 1 })).toEqual(['right'])
    expect(unmetSkillPrerequisiteIds(skill, { right: 3 })).toEqual(['left'])
    expect(unmetSkillPrerequisiteIds(skill, { left: 1, right: 3 })).toEqual([])
  })

  it('keeps legacy requiresSkill as one prerequisite option', () => {
    const skill = { requiresSkill: 'legacy_parent' }

    expect(skillPrerequisiteIds(skill)).toEqual(['legacy_parent'])
    expect(unmetSkillPrerequisiteIds(skill, {})).toEqual(['legacy_parent'])
    expect(unmetSkillPrerequisiteIds(skill, { legacy_parent: 1 })).toEqual([])
  })

  it('prefers the current multi-parent field over a legacy value', () => {
    expect(
      skillPrerequisiteIds({
        requiresAllOf: ['current_parent'],
        requiresSkill: 'legacy_parent',
      }),
    ).toEqual(['current_parent'])
  })

  it('has no unmet requirements when a skill has no prerequisite', () => {
    expect(unmetSkillPrerequisiteIds({}, {})).toEqual([])
  })
})
