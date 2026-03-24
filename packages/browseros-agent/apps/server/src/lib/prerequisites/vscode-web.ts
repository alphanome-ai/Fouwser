import { appendFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import type { Browser } from '../../browser/browser'
import {
  DEFAULT_BACKGROUND_MAX_RUNTIME_SECONDS,
  ensureProcessRuntimeDir,
  registerBackgroundProcess,
  removeBackgroundProcessRecord,
  runProcessRuntimeMaintenance,
} from '../../tools/filesystem/process-runtime'
import { logger } from '../logger'

interface VsCodeWebServerState {
  baseUrl: string
  port: number
  process: ReturnType<typeof Bun.spawn>
  runtimeRoot: string
  logPath: string
  expiresAtMs: number | null
}

const START_TIMEOUT_MS = 20_000
const OUTPUT_BUFFER_LIMIT = 24_000
const OUTPUT_SNIPPET_LIMIT = 300
const VSCODE_WEB_TOOL_NAME = 'vscode_web_server'
const VSCODE_WEB_MAX_RUNTIME_SECONDS = DEFAULT_BACKGROUND_MAX_RUNTIME_SECONDS
const PROCESS_RUNTIME_ROOT = process.cwd()

let serverState: VsCodeWebServerState | null = null
let serverStartPromise: Promise<VsCodeWebServerState> | null = null

const openedFolders = new Set<string>()

function isProcessAlive(proc: ReturnType<typeof Bun.spawn>): boolean {
  const pid = proc.pid
  if (typeof pid !== 'number' || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function extractWebUiUrl(text: string): string | null {
  const match = text.match(/Web UI available at (https?:\/\/\S+)/)
  return match?.[1] ?? null
}

async function findAvailablePort(host = '127.0.0.1'): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.unref()

    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a free port')))
        return
      }

      const port = address.port
      server.close((err) => {
        if (err) reject(err)
        else resolvePort(port)
      })
    })
  })
}

async function waitForWebUiUrl(
  process: ReturnType<typeof Bun.spawn>,
  logPath: string,
): Promise<string> {
  const decoder = new TextDecoder()
  let output = ''

  const appendAndExtract = (chunk: string): string | null => {
    output += chunk
    if (output.length > OUTPUT_BUFFER_LIMIT) {
      output = output.slice(-OUTPUT_BUFFER_LIMIT)
    }
    return extractWebUiUrl(output)
  }

  return new Promise<string>((resolveUrl, reject) => {
    let settled = false

    const settle = (value: string | Error, isError = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (isError) {
        reject(value as Error)
      } else {
        resolveUrl(value as string)
      }
    }

    const timer = setTimeout(() => {
      const snippet = output.trim().slice(-OUTPUT_SNIPPET_LIMIT)
      settle(
        new Error(
          snippet
            ? `Timed out waiting for VS Code Web URL. Output: ${snippet}`
            : 'Timed out waiting for VS Code Web URL.',
        ),
        true,
      )
    }, START_TIMEOUT_MS)

    const consume = async (stream: ReadableStream<Uint8Array> | null) => {
      if (!stream) return
      const reader = stream.getReader()
      try {
        while (!settled) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          void appendFile(logPath, chunk).catch(() => {})
          const url = appendAndExtract(chunk)
          if (url) {
            settle(url)
            break
          }
        }
      } catch (error) {
        settle(
          new Error(
            `Failed reading VS Code Web output: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
          true,
        )
      } finally {
        reader.releaseLock()
      }
    }

    void consume(process.stdout as ReadableStream<Uint8Array> | null)
    void consume(process.stderr as ReadableStream<Uint8Array> | null)

    process.exited.then((code) => {
      if (settled) return
      const snippet = output.trim().slice(-OUTPUT_SNIPPET_LIMIT)
      settle(
        new Error(
          snippet
            ? `VS Code Web server exited with code ${code}. Output: ${snippet}`
            : `VS Code Web server exited with code ${code}.`,
        ),
        true,
      )
    })
  })
}

async function startVsCodeWebServer(): Promise<VsCodeWebServerState> {
  await runProcessRuntimeMaintenance(PROCESS_RUNTIME_ROOT)
  const port = await findAvailablePort('127.0.0.1')
  const procDir = await ensureProcessRuntimeDir(PROCESS_RUNTIME_ROOT)
  const logPath = join(procDir, `vscode-web-${Date.now()}-${port}.log`)
  const childProcess = Bun.spawn(
    ['code', 'serve-web', '--host=127.0.0.1', `--port=${port}`],
    {
      cwd: PROCESS_RUNTIME_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    },
  )

  const pid = childProcess.pid
  let expiresAtMs: number | null = null

  try {
    const baseUrl = await waitForWebUiUrl(childProcess, logPath)

    if (typeof pid === 'number' && pid > 0) {
      const registration = await registerBackgroundProcess({
        toolCwd: PROCESS_RUNTIME_ROOT,
        pid,
        command: `code serve-web --host=127.0.0.1 --port=${port}`,
        commandCwd: PROCESS_RUNTIME_ROOT,
        logPath,
        toolName: VSCODE_WEB_TOOL_NAME,
        maxRuntimeSeconds: VSCODE_WEB_MAX_RUNTIME_SECONDS,
      })
      expiresAtMs = registration.expiresAtMs
    }

    const state: VsCodeWebServerState = {
      baseUrl,
      port,
      process: childProcess,
      runtimeRoot: PROCESS_RUNTIME_ROOT,
      logPath,
      expiresAtMs,
    }

    childProcess.exited.then((code) => {
      if (serverState?.process === childProcess) {
        logger.warn('VS Code Web server exited', { code, port })
        serverState = null
      }
      if (typeof pid === 'number' && pid > 0) {
        void removeBackgroundProcessRecord({
          toolCwd: PROCESS_RUNTIME_ROOT,
          pid,
        })
      }
    })

    logger.info('VS Code Web server started', {
      port,
      baseUrl,
      logPath,
      maxRuntimeSeconds: VSCODE_WEB_MAX_RUNTIME_SECONDS,
      expiresAtMs,
    })
    return state
  } catch (error) {
    try {
      childProcess.kill()
    } catch {
      // ignore
    }
    if (typeof pid === 'number' && pid > 0) {
      await removeBackgroundProcessRecord({
        toolCwd: PROCESS_RUNTIME_ROOT,
        pid,
      })
    }
    throw error
  }
}

async function ensureVsCodeWebServer(): Promise<VsCodeWebServerState> {
  await runProcessRuntimeMaintenance(PROCESS_RUNTIME_ROOT)

  if (serverState && isProcessAlive(serverState.process)) return serverState
  if (serverState && !isProcessAlive(serverState.process)) {
    serverState = null
  }
  if (serverStartPromise) return serverStartPromise

  serverStartPromise = startVsCodeWebServer()
  try {
    serverState = await serverStartPromise
    return serverState
  } finally {
    serverStartPromise = null
  }
}

export async function getVsCodeWebUiUrlForFolder(
  folderPath: string,
): Promise<string> {
  const state = await ensureVsCodeWebServer()
  const resolvedFolder = resolve(folderPath)
  const url = new URL(state.baseUrl)
  url.searchParams.set('folder', resolvedFolder)
  return url.toString()
}

export async function openVsCodeWebUiForFolder(
  browser: Browser,
  folderPath: string,
  options?: { forceNewTab?: boolean },
): Promise<string> {
  const resolvedFolder = resolve(folderPath)
  const url = await getVsCodeWebUiUrlForFolder(resolvedFolder)
  if (!options?.forceNewTab && openedFolders.has(resolvedFolder)) {
    return url
  }

  await browser.newPage(url)
  openedFolders.add(resolvedFolder)
  logger.info('Opened VS Code Web UI tab', {
    folderPath: resolvedFolder,
    webUiUrl: url,
  })
  return url
}
