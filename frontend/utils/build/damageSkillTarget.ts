import { getSkillsByClass } from '@data'
import type { Skill } from '../../types'
import type { BuildPerformanceDeps } from './buildPerformance'

type DamageSkillSelection = Pick<
  BuildPerformanceDeps,
  'classId' | 'skillRanks' | 'activeSkillIds'
>

function hasDamageModel(skill: Skill): boolean {
  return Boolean(
    skill.damageFormula || skill.damagePerRank?.length || skill.attackScaling,
  )
}

export function getAllocatedDamageSkills(
  deps: Pick<BuildPerformanceDeps, 'classId' | 'skillRanks'>,
): Skill[] {
  if (!deps.classId) return []
  return getSkillsByClass(deps.classId).filter(
    (skill) =>
      skill.kind === 'active' &&
      (deps.skillRanks[skill.id] ?? 0) > 0 &&
      hasDamageModel(skill),
  )
}

export function resolveAllocatedDamageSkillId(
  deps: DamageSkillSelection,
): string | null {
  const eligibleSkills = getAllocatedDamageSkills(deps)
  const configuredSkillId = deps.activeSkillIds.find((id) =>
    eligibleSkills.some((skill) => skill.id === id),
  )
  return configuredSkillId ?? eligibleSkills[0]?.id ?? null
}

export function withExactDamageSkillTarget(
  deps: BuildPerformanceDeps,
  skillId: string,
): BuildPerformanceDeps {
  if (deps.activeSkillIds.length === 1 && deps.activeSkillIds[0] === skillId) {
    return deps
  }
  return { ...deps, activeSkillIds: [skillId] }
}
