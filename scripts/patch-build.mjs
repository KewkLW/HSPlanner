import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  expectedSummary,
  inventoryChanges,
  verifySummary,
} from './patch-build-lib.mjs'

const bridgeUrl = 'http://127.0.0.1:5173/__hsplanner/import-build'
const tokenFile = join(homedir(), '.hsplanner', 'dev-import-5173.token')

const [requestPath] = process.argv.slice(2)
if (!requestPath) {
  console.error('Usage: node scripts/patch-build.mjs <patch-request.json>')
  process.exit(2)
}

async function send(token, body) {
  const response = await fetch(bridgeUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  })
  const result = await response.json()
  if (!response.ok || result?.ok !== true) {
    const error = new Error(result?.error || `patch failed with HTTP ${response.status}`)
    error.conflict = response.status === 409
    throw error
  }
  return result
}

try {
  const [requestText, tokenText] = await Promise.all([
    readFile(requestPath, 'utf8'),
    readFile(tokenFile, 'utf8'),
  ])
  const request = JSON.parse(requestText)
  if (
    typeof request?.buildId !== 'string' ||
    typeof request?.profileId !== 'string' ||
    typeof request?.season !== 'string' ||
    typeof request?.patch !== 'object' ||
    request.patch === null ||
    Array.isArray(request.patch)
  ) {
    throw new Error('request must contain buildId, profileId, season, and patch')
  }

  const base = {
    operation: 'patch',
    buildId: request.buildId,
    profileId: request.profileId,
    season: request.season,
    patch: request.patch,
  }
  const token = tokenText.trim()
  const expected = expectedSummary(request.patch)
  let applied
  let before
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    before = await send(token, { ...base, dryRun: true })
    try {
      applied = await send(token, {
        ...base,
        dryRun: false,
        expectedRevision: before.revision,
      })
      break
    } catch (error) {
      if (!error.conflict || attempt === 3) throw error
    }
  }
  if (!applied || !before) throw new Error('patch was not applied')
  if (
    applied.buildId !== request.buildId ||
    applied.profileId !== request.profileId
  ) {
    throw new Error('bridge updated an unexpected target')
  }
  verifySummary(applied, expected, before)
  const appliedInventoryChanges = inventoryChanges(before.inventory, applied.inventory)
  if (appliedInventoryChanges.length > 0) {
    console.error(
      `Warning: patch changed equipped gear: ${appliedInventoryChanges
        .map(({ slot, change }) => `${slot} ${change}`)
        .join(', ')}. The applied inventory is now the verification baseline.`,
    )
  }

  // The live store's autosave debounce is 800 ms. Re-read after that window
  // to prove it did not overwrite the synchronized patch with stale state.
  await new Promise((resolve) => setTimeout(resolve, 1_100))
  const persisted = await send(token, { ...base, dryRun: true })
  verifySummary(persisted, expected, before, applied.inventory)

  console.log(
    JSON.stringify({
      ok: true,
      buildId: applied.buildId,
      profileId: applied.profileId,
      name: applied.name,
      profileName: applied.profileName,
      gearSlots: persisted.gearSlots,
      incarnationSlots: persisted.incarnationNodes?.map((nodes) =>
        nodes ? nodes.length : null,
      ),
      etherSlots: persisted.etherNodes?.map((nodes) =>
        nodes ? nodes.length : null,
      ),
      inventoryChanges: appliedInventoryChanges,
      mercClassId: persisted.mercClassId,
      mercSkillPoints: persisted.mercSkillPoints,
    }),
  )
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`Could not patch build: ${detail}`)
  console.error('Make sure `npm run tauri:dev` is running, then try again.')
  process.exitCode = 1
}
