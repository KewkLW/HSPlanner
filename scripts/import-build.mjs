import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import LZString from 'lz-string'

const { compressToEncodedURIComponent } = LZString
const importUrl = 'http://127.0.0.1:5173/__hsplanner/import-build'
const tokenFile = join(homedir(), '.hsplanner', 'dev-import-5173.token')

const [payloadPath, requestedName] = process.argv.slice(2)
if (!payloadPath) {
  console.error('Usage: node scripts/import-build.mjs <share-payload.json> [build name]')
  process.exit(2)
}

try {
  const [payloadText, tokenText] = await Promise.all([
    readFile(payloadPath, 'utf8'),
    readFile(tokenFile, 'utf8'),
  ])
  const payload = JSON.parse(payloadText)
  const code = compressToEncodedURIComponent(JSON.stringify(payload))
  const response = await fetch(importUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokenText.trim()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ code, ...(requestedName ? { name: requestedName } : {}) }),
    signal: AbortSignal.timeout(12_000),
  })
  const result = await response.json()
  if (!response.ok || result?.ok !== true) {
    throw new Error(result?.error || `import failed with HTTP ${response.status}`)
  }
  console.log(JSON.stringify(result))
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`Could not import build: ${detail}`)
  console.error('Make sure `npm run tauri:dev` is running, then try again.')
  process.exitCode = 1
}
