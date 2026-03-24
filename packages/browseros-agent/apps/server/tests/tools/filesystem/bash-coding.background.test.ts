import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createBashCodingTool } from '../../../src/tools/filesystem/bash-coding'
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

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `fs-bash-coding-bg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await mkdir(tmpDir, { recursive: true })
  const tool = createBashCodingTool(tmpDir)
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  exec = (params) => (tool as any).execute(params)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('filesystem_bash_coding background mode', () => {
  if (process.platform === 'win32') {
    it('returns unsupported error on Windows', async () => {
      const result = await exec({ command: 'echo hello', background: true })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('not supported on Windows')
    })
    return
  }

  it('starts a long-running background command and writes a log file', async () => {
    const result = await exec({
      command: 'echo "coding-bg-ok"; sleep 2',
      background: true,
    })

    expect(result.isError).toBeUndefined()
    expect(result.text).toContain('Started background command.')

    const logPath = extractLogPath(result.text)
    expect(logPath.startsWith(`${resolve(tmpDir)}/`)).toBe(true)

    const content = await waitForLogToContain(logPath, 'coding-bg-ok')
    expect(content).toContain('coding-bg-ok')
  })

  it('persists coding background process metadata under .fouwser/proc', async () => {
    const result = await exec({
      command: 'echo "coding-managed-ok"; sleep 5',
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
    }

    expect(record.pid).toBe(pid)
    expect(record.toolName).toBe('filesystem_bash_coding')
    expect(record.command).toContain('coding-managed-ok')
    expect(record.cwd).toBe(resolve(tmpDir))
    expect(record.logPath.startsWith(resolve(tmpDir))).toBe(true)
  })

  it('fails fast when long-running startup check detects immediate exit', async () => {
    const result = await exec({
      command: 'echo "boom"; sleep 0.1',
      background: true,
    })

    expect(result.isError).toBe(true)
    expect(result.text).toContain('Background process exited during startup.')
    expect(result.text).toContain('Startup log tail:')
    expect(result.text).toContain('boom')
  })

  it('can disable long-running check for short-lived background commands', async () => {
    const result = await exec({
      command: 'echo "short-lived"; exit 1',
      background: true,
      expectLongRunning: false,
    })

    expect(result.isError).toBeUndefined()
    expect(result.text).toContain('Started background command.')
  })
})
