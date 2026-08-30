import type { Skill } from '../../types'

export function skillPrerequisiteIds(
  skill: Pick<Skill, 'requiresAllOf' | 'requiresSkill'>,
): readonly string[] {
  if (skill.requiresAllOf?.length) return skill.requiresAllOf
  return skill.requiresSkill ? [skill.requiresSkill] : []
}

export function unmetSkillPrerequisiteIds(
  skill: Pick<Skill, 'requiresAllOf' | 'requiresSkill'>,
  ranks: Readonly<Record<string, number>>,
): string[] {
  return skillPrerequisiteIds(skill).filter((id) => (ranks[id] ?? 0) <= 0)
}
