/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { WebSocketClient } from 'vite'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string }

const host = process.env.TAURI_DEV_HOST

const HEADLESS_IMPORT_PATH = '/__hsplanner/import-build'
const HEADLESS_IMPORT_REGISTER_EVENT = 'hsplanner:register-import-client'
const HEADLESS_IMPORT_UNREGISTER_EVENT = 'hsplanner:unregister-import-client'
const HEADLESS_IMPORT_EVENT = 'hsplanner:import-build'
const HEADLESS_IMPORT_RESULT_EVENT = 'hsplanner:import-build-result'
const MAX_HEADLESS_IMPORT_BYTES = 250_000
const MAX_PENDING_HEADLESS_IMPORTS = 8
const HEADLESS_IMPORT_DIR = join(homedir(), '.hsplanner')
const HEADLESS_IMPORT_TOKEN_FILE = join(
  HEADLESS_IMPORT_DIR,
  'dev-import-5173.token',
)

function isLoopback(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

function isTrustedImportOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

function secretsEqual(actualValue: unknown, expectedValue: string): boolean {
  if (typeof actualValue !== 'string') return false
  const actual = Buffer.from(actualValue)
  const expected = Buffer.from(expectedValue)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function hasImportToken(header: string | undefined, token: string): boolean {
  return secretsEqual(header, `Bearer ${token}`)
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'splash-version',
      transformIndexHtml: (html) => html.replaceAll('__APP_VERSION__', pkg.version),
    },
    {
      name: 'headless-build-import',
      apply: 'serve',
      configureServer(server) {
        if (server.config.mode === 'test') return
        const importToken = randomBytes(32).toString('hex')
        mkdirSync(HEADLESS_IMPORT_DIR, { recursive: true, mode: 0o700 })
        try {
          chmodSync(HEADLESS_IMPORT_DIR, 0o700)
        } catch {
          // Windows protects this directory with the current user's ACL instead.
        }
        server.httpServer?.once('listening', () => {
          rmSync(HEADLESS_IMPORT_TOKEN_FILE, { force: true })
          writeFileSync(HEADLESS_IMPORT_TOKEN_FILE, importToken, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
          })
        })
        server.httpServer?.once('close', () => {
          try {
            if (readFileSync(HEADLESS_IMPORT_TOKEN_FILE, 'utf8') === importToken) {
              rmSync(HEADLESS_IMPORT_TOKEN_FILE)
            }
          } catch {
            // A newer dev server may already own the token file.
          }
        })

        let importRegistration: {
          client: WebSocketClient
          registrationId: string
        } | null = null
        const clientsWithCloseHandler = new WeakSet<WebSocketClient>()
        const pending = new Map<
          string,
          {
            client: WebSocketClient
            finish: (status: number, payload: object) => void
            timeout: NodeJS.Timeout
          }
        >()

        const failPendingForClient = (client: WebSocketClient, error: string) => {
          for (const [requestId, request] of pending) {
            if (request.client !== client) continue
            clearTimeout(request.timeout)
            pending.delete(requestId)
            request.finish(503, { ok: false, requestId, error })
          }
        }

        server.ws.on(HEADLESS_IMPORT_REGISTER_EVENT, (data, client) => {
          if (
            !data ||
            typeof data !== 'object' ||
            typeof (data as { registrationId?: unknown }).registrationId !== 'string' ||
            !secretsEqual(
              (data as { token?: unknown }).token,
              importToken,
            )
          ) {
            return
          }
          importRegistration = {
            client,
            registrationId: (data as { registrationId: string }).registrationId,
          }
          if (!clientsWithCloseHandler.has(client)) {
            clientsWithCloseHandler.add(client)
            client.socket.once('close', () => {
              if (importRegistration?.client === client) importRegistration = null
              failPendingForClient(client, 'HS Planner disconnected during import')
            })
          }
        })

        server.ws.on(HEADLESS_IMPORT_UNREGISTER_EVENT, (data, client) => {
          const current = importRegistration
          if (
            !data ||
            typeof data !== 'object' ||
            !current ||
            current.client !== client ||
            (data as { registrationId?: unknown }).registrationId !==
              current.registrationId
          ) {
            return
          }
          importRegistration = null
          failPendingForClient(client, 'HS Planner importer reloading')
        })

        server.ws.on(HEADLESS_IMPORT_RESULT_EVENT, (data, client) => {
          if (!data || typeof data !== 'object') return
          const requestId = (data as { requestId?: unknown }).requestId
          if (typeof requestId !== 'string') return
          const request = pending.get(requestId)
          if (!request || request.client !== client) return
          clearTimeout(request.timeout)
          pending.delete(requestId)
          const ok = (data as { ok?: unknown }).ok === true
          const conflict = (data as { conflict?: unknown }).conflict === true
          request.finish(ok ? 200 : conflict ? 409 : 422, data as object)
        })

        server.middlewares.use(HEADLESS_IMPORT_PATH, (req, res, next) => {
          if (req.method !== 'POST') return next()
          if (!isLoopback(req.socket.remoteAddress)) {
            res.statusCode = 403
            res.end(JSON.stringify({ ok: false, error: 'loopback-only endpoint' }))
            return
          }
          if (!isTrustedImportOrigin(req.headers.origin)) {
            res.statusCode = 403
            res.end(JSON.stringify({ ok: false, error: 'untrusted origin' }))
            return
          }
          if (!hasImportToken(req.headers.authorization, importToken)) {
            res.statusCode = 401
            res.end(JSON.stringify({ ok: false, error: 'invalid import token' }))
            return
          }
          const mediaType = req.headers['content-type']
            ?.split(';', 1)[0]
            ?.trim()
            .toLowerCase()
          if (mediaType !== 'application/json') {
            res.statusCode = 415
            res.end(JSON.stringify({ ok: false, error: 'application/json is required' }))
            return
          }

          let bytes = 0
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => {
            if (res.writableEnded) return
            bytes += chunk.length
            if (bytes > MAX_HEADLESS_IMPORT_BYTES) {
              res.statusCode = 413
              res.end(JSON.stringify({ ok: false, error: 'payload too large' }))
              return
            }
            chunks.push(chunk)
          })
          req.on('end', () => {
            if (res.writableEnded) return
            let payload: {
              operation?: unknown
              code?: unknown
              name?: unknown
              buildId?: unknown
              profileId?: unknown
              season?: unknown
              patch?: unknown
              dryRun?: unknown
              expectedRevision?: unknown
            }
            try {
              payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }))
              return
            }
            const operation = payload.operation ?? 'import'
            if (operation === 'import') {
              if (typeof payload.code !== 'string' || !payload.code) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, error: 'code is required' }))
                return
              }
              if (payload.name !== undefined && typeof payload.name !== 'string') {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, error: 'name must be a string' }))
                return
              }
            } else if (operation === 'patch') {
              if (
                typeof payload.buildId !== 'string' ||
                typeof payload.profileId !== 'string' ||
                typeof payload.season !== 'string' ||
                typeof payload.patch !== 'object' ||
                payload.patch === null ||
                Array.isArray(payload.patch) ||
                typeof payload.dryRun !== 'boolean' ||
                (!payload.dryRun && typeof payload.expectedRevision !== 'string')
              ) {
                res.statusCode = 400
                res.end(
                  JSON.stringify({
                    ok: false,
                    error: 'invalid patch request',
                  }),
                )
                return
              }
            } else {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'unsupported operation' }))
              return
            }
            if (!importRegistration) {
              res.statusCode = 503
              res.end(JSON.stringify({ ok: false, error: 'HS Planner is not connected' }))
              return
            }
            if (pending.size >= MAX_PENDING_HEADLESS_IMPORTS) {
              res.statusCode = 429
              res.end(JSON.stringify({ ok: false, error: 'too many pending imports' }))
              return
            }

            const requestId = randomUUID()
            const client = importRegistration.client
            const finish = (status: number, body: object) => {
              if (res.writableEnded) return
              res.statusCode = status
              res.setHeader('content-type', 'application/json; charset=utf-8')
              res.end(JSON.stringify(body))
            }
            const timeout = setTimeout(() => {
              pending.delete(requestId)
              finish(504, { ok: false, requestId, error: 'planner did not acknowledge import' })
            }, 10_000)
            pending.set(requestId, { client, finish, timeout })
            try {
              client.send(HEADLESS_IMPORT_EVENT, {
                requestId,
                operation,
                code: payload.code,
                name: payload.name,
                buildId: payload.buildId,
                profileId: payload.profileId,
                season: payload.season,
                patch: payload.patch,
                dryRun: payload.dryRun,
                expectedRevision: payload.expectedRevision,
              })
            } catch {
              clearTimeout(timeout)
              pending.delete(requestId)
              finish(503, {
                ok: false,
                requestId,
                error: 'HS Planner disconnected before import',
              })
            }
          })
        })
      },
    },
  ],
  clearScreen: false,
  resolve: {
    alias: {
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 5174 }
      : undefined,
    watch: { ignored: ['**/engine/**'] },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./frontend/test/setup.ts'],
    include: ['{frontend,data}/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
})
