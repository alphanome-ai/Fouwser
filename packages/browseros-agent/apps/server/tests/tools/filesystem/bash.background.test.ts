import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createBashTool } from '../../../src/tools/filesystem/bash'
import type { FilesystemToolResult } from '../../../src/tools/filesystem/utils'

let tmpDir: string
let exec: (params: Record<string, unknown>) => Promise<FilesystemToolResult>

async function waitForLogToContain(
  logPath: string,
  expectedText: string,
  timeoutMs = 3_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const content = await readFile(logPath, 'utf-8')
      if (content.includes(expectedText)) return content
    } catch {
      // Ignore while log file has not been created yet.
    }
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for "${expectedText}" in log ${logPath}`)
}

function extractLogPath(toolText: string): string {
  const match = toolText.match(/Log:\s+(.+)$/m)
  if (!match?.[1]) {
    throw new Error(`Unable to parse log path from tool output:\n${toolText}`)
  }
  return match[1].trim()
}

function extractPid(toolText: string): number {
  const match = toolText.match(/PID:\s+(\d+)/m)
  if (!match?.[1]) {
    throw new Error(`Unable to parse pid from tool output:\n${toolText}`)
  }
  return Number.parseInt(match[1], 10)
}

function extractRegistryPath(toolText: string): string {
  const match = toolText.match(/Process registry:\s+(.+)$/m)
  if (!match?.[1]) {
    throw new Error(
      `Unable to parse process registry path from tool output:\n${toolText}`,
    )
  }
  return match[1].trim()
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `fs-bash-bg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await mkdir(tmpDir, { recursive: true })
  const tool = createBashTool(tmpDir)
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  exec = (params) => (tool as any).execute(params)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('filesystem_bash background mode', () => {
  if (process.platform === 'win32') {
    it('returns unsupported error on Windows', async () => {
      const result = await exec({ command: 'echo hello', background: true })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('not supported on Windows')
    })
    return
  }

  it('starts a background command and writes a default repo-local log file', async () => {
    const result = await exec({
      command: 'echo "bg-default-ok"',
      background: true,
    })

    expect(result.isError).toBeUndefined()
    expect(result.text).toContain('Started background command.')

    const logPath = extractLogPath(result.text)
    expect(logPath.startsWith(`${resolve(tmpDir)}/`)).toBe(true)
    expect(logPath).toContain('/.browseros-bg-')

    const content = await waitForLogToContain(logPath, 'bg-default-ok')
    expect(content).toContain('bg-default-ok')
  })

  it('persists background process metadata under .fouwser/proc', async () => {
    const result = await exec({
      command: 'echo "managed-bg-ok"; sleep 5',
      background: true,
    })

    expect(result.isError).toBeUndefined()
    const pid = extractPid(result.text)
    const procDir = extractRegistryPath(result.text)
    const recordPath = join(procDir, `${pid}.json`)

    const rawRecord = await readFile(recordPath, 'utf-8')
    const record = JSON.parse(rawRecord) as {
      pid: number
      toolName: string
      command: string
      cwd: string
      logPath: string
      expiresAtMs: number
      startedAtMs: number
    }

    expect(record.pid).toBe(pid)
    expect(record.toolName).toBe('filesystem_bash')
    expect(record.command).toContain('managed-bg-ok')
    expect(record.cwd).toBe(resolve(tmpDir))
    expect(record.logPath.startsWith(resolve(tmpDir))).toBe(true)
    expect(record.expiresAtMs).toBeGreaterThan(record.startedAtMs)
  })

  it('uses command cwd and writes relative logFile inside that cwd', async () => {
    const repoDir = join(tmpDir, 'repo-a')
    await mkdir(repoDir, { recursive: true })

    const result = await exec({
      command: 'pwd',
      background: true,
      cwd: 'repo-a',
      logFile: 'dev-server.log',
    })

    expect(result.isError).toBeUndefined()
    const logPath = extractLogPath(result.text)
    expect(logPath).toBe(resolve(repoDir, 'dev-server.log'))

    const content = await waitForLogToContain(logPath, resolve(repoDir))
    expect(content.trim()).toContain(resolve(repoDir))
  })

  it('rejects absolute logFile paths', async () => {
    const result = await exec({
      command: 'echo nope',
      background: true,
      logFile: resolve(tmpDir, 'abs.log'),
    })

    expect(result.isError).toBe(true)
    expect(result.text).toContain('logFile must be a relative path inside cwd.')
  })

  it('rejects logFile paths that escape cwd', async () => {
    await mkdir(join(tmpDir, 'repo-b'), { recursive: true })

    const result = await exec({
      command: 'echo nope',
      background: true,
      cwd: 'repo-b',
      logFile: '../outside.log',
    })

    expect(result.isError).toBe(true)
    expect(result.text).toContain('logFile must resolve inside cwd.')
  })

  it('kills and removes expired managed background processes on next run', async () => {
    const startResult = await exec({
      command: 'sleep 30',
      background: true,
      maxRuntimeSeconds: 1,
    })

    expect(startResult.isError).toBeUndefined()
    const pid = extractPid(startResult.text)
    const procDir = extractRegistryPath(startResult.text)
    const recordPath = join(procDir, `${pid}.json`)

    await Bun.sleep(2_100)
    const trigger = await exec({ command: 'echo "cleanup-trigger"' })
    expect(trigger.isError).toBeUndefined()

    await Bun.sleep(400)
    expect(isPidRunning(pid)).toBe(false)

    const recordExists = await Bun.file(recordPath).exists()
    expect(recordExists).toBe(false)
  }, 20_000)
})
