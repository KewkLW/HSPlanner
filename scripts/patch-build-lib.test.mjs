import assert from 'node:assert/strict'
import test from 'node:test'
import {
  expectedSummary,
  inventoryChanges,
  verifySummary,
} from './patch-build-lib.mjs'

function summary(inventory) {
  return {
    buildCount: 1,
    name: 'Build',
    profileName: 'Default',
    season: 's10',
    gearSlots: Object.keys(inventory).length,
    inventory,
    incarnationNodes: [],
    incarnationSockets: [],
    etherNodes: [],
    mercClassId: 'merc_magister',
    mercSkillRanks: { tome_of_power: 20 },
    mercSkillPoints: 20,
  }
}

test('canonicalizes zero mercenary ranks before exact verification', () => {
  const expected = expectedSummary({
    mercClassId: 'merc_magister',
    mercSkillRanks: { elemental_intellect: 0, tome_of_power: 20 },
  })

  assert.deepEqual(expected.mercSkillRanks, { tome_of_power: 20 })
  assert.equal(expected.mercSkillPoints, 20)
  assert.doesNotThrow(() =>
    verifySummary(summary({ weapon: { baseId: 'wand' } }), expected, {
      ...summary({ weapon: { baseId: 'wand' } }),
      incarnationSockets: [],
    }),
  )
})

test('treats the applied inventory as canonical and reports slot changes', () => {
  const before = summary({
    weapon: { baseId: 'two-handed-weapon' },
    offhand: { baseId: 'shield' },
  })
  const applied = summary({ weapon: { baseId: 'two-handed-weapon' } })
  const expected = expectedSummary({})

  assert.deepEqual(inventoryChanges(before.inventory, applied.inventory), [
    { slot: 'offhand', change: 'removed' },
  ])
  assert.doesNotThrow(() => verifySummary(applied, expected, before))
  assert.doesNotThrow(() =>
    verifySummary(applied, expected, before, applied.inventory),
  )
  assert.throws(
    () => verifySummary(before, expected, before, applied.inventory),
    /equipped gear changed after the applied patch response/,
  )
})
