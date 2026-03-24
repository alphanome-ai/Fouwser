import { createServer } from 'node:net'
import { resolve } from 'node:path'
import type { Browser } from '../../browser/browser'
import { logger } from '../logger'

interface VsCodeWebServerState {
  baseUrl: string
  port: number
  process: ReturnType<typeof Bun.spawn>
}

const START_TIMEOUT_MS = 20_000
const OUTPUT_BUFFER_LIMIT = 24_000
const OUTPUT_SNIPPET_LIMIT = 300

let serverState: VsCodeWebServerState | null = null
let serverStartPromise: Promise<VsCodeWebServerState> | null = null

const openedFolders = new Set<string>()

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
  const port = await findAvailablePort('127.0.0.1')
  const childProcess = Bun.spawn(
    ['code', 'serve-web', '--host=127.0.0.1', `--port=${port}`],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    },
  )

  try {
    const baseUrl = await waitForWebUiUrl(childProcess)
    const state = { baseUrl, port, process: childProcess }

    childProcess.exited.then((code) => {
      if (serverState?.process === childProcess) {
        logger.warn('VS Code Web server exited', { code, port })
        serverState = null
      }
    })

    logger.info('VS Code Web server started', { port, baseUrl })
    return state
  } catch (error) {
    try {
      childProcess.kill()
    } catch {
      // ignore
    }
    throw error
  }
}

async function ensureVsCodeWebServer(): Promise<VsCodeWebServerState> {
  if (serverState) return serverState
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
