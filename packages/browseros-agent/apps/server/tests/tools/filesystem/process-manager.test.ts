import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBashCodingTool } from '../../../src/tools/filesystem/bash-coding'
import { createProcessManagerTool } from '../../../src/tools/filesystem/process-manager'
import { registerBackgroundProcess } from '../../../src/tools/filesystem/process-runtime'
import type { FilesystemToolResult } from '../../../src/tools/filesystem/utils'

let tmpDir: string
let execBash: (params: Record<string, unknown>) => Promise<FilesystemToolResult>
let execProcessManager: (
  params: Record<string, unknown>,
) => Promise<FilesystemToolResult>

function extractPid(toolText: string): number {
  const match = toolText.match(/PID:\s+(\d+)/m)
  if (!match?.[1]) {
    throw new Error(`Unable to parse pid from tool output:\n${toolText}`)
  }
  return Number.parseInt(match[1], 10)
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
    `fs-process-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await mkdir(tmpDir, { recursive: true })
  const bashTool = createBashCodingTool(tmpDir)
  const processManagerTool = createProcessManagerTool(tmpDir)
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  execBash = (params) => (bashTool as any).execute(params)
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  execProcessManager = (params) => (processManagerTool as any).execute(params)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('filesystem_process_manager', () => {
  if (process.platform === 'win32') {
    it('lists managed processes without crashing on Windows', async () => {
      const result = await execProcessManager({ action: 'list' })
      expect(result.isError).toBeUndefined()
      expect(result.text).toContain('Process registry:')
    })
    return
  }

  it('lists and kills a managed process by pid', async () => {
    const startResult = await execBash({
      command: 'sleep 30',
      background: true,
    })
    expect(startResult.isError).toBeUndefined()

    const pid = extractPid(startResult.text)

    const listResult = await execProcessManager({ action: 'list' })
    expect(listResult.isError).toBeUndefined()
    expect(listResult.text).toContain(`PID ${pid}`)

    const killResult = await execProcessManager({ action: 'kill', pid })
    expect(killResult.isError).toBeUndefined()
    expect(killResult.text).toContain(`PID ${pid}`)

    await Bun.sleep(200)
    expect(isPidRunning(pid)).toBe(false)

    const listAfterKill = await execProcessManager({ action: 'list' })
    expect(listAfterKill.text).not.toContain(`PID ${pid}`)
  })

  it('kills matching managed processes with filters', async () => {
    const first = await execBash({
      command: 'sleep 30',
      background: true,
      cwd: '.',
    })
    const second = await execBash({
      command: 'sleep 30',
      background: true,
      cwd: '.',
    })
    expect(first.isError).toBeUndefined()
    expect(second.isError).toBeUndefined()

    const pidA = extractPid(first.text)
    const pidB = extractPid(second.text)

    const killAll = await execProcessManager({
      action: 'kill_all',
      toolName: 'filesystem_bash_coding',
      cwd: tmpDir,
      commandContains: 'sleep 30',
    })
    expect(killAll.text).toContain('Matched managed processes:')
    expect(killAll.text).toContain('Killed:')
    expect(killAll.isError).toBeUndefined()

    await Bun.sleep(200)
    expect(isPidRunning(pidA)).toBe(false)
    expect(isPidRunning(pidB)).toBe(false)
  })

  it('stores port in proc record when provided', async () => {
    const port = 64_433
    const registration = await registerBackgroundProcess({
      toolCwd: tmpDir,
      pid: 999_999,
      port,
      command: `code serve-web --host=127.0.0.1 --port=${port}`,
      commandCwd: tmpDir,
      logPath: join(tmpDir, 'vscode.log'),
      toolName: 'vscode_web_server',
      maxRuntimeSeconds: 60,
    })

    const rawRecord = await Bun.file(registration.recordPath).text()
    const record = JSON.parse(rawRecord) as { port?: number }
    expect(record.port).toBe(port)

    await rm(registration.recordPath, { force: true })
  })

  it('kills process by stored port when recorded pid is stale', async () => {
    if (!Bun.which('bash')) {
      expect(true).toBe(true)
      return
    }

    const listenerProcess = Bun.spawn(
      ['bash', '-lc', 'exec -a port-owner sleep 30'],
      {
        cwd: tmpDir,
        stdout: 'ignore',
        stderr: 'ignore',
        env: { ...process.env },
      },
    )
    const listenerPid = listenerProcess.pid
    if (typeof listenerPid !== 'number' || listenerPid <= 0) {
      throw new Error('Failed to start listener process')
    }
    expect(isPidRunning(listenerPid)).toBe(true)

    const fakeBinDir = join(tmpDir, 'fake-bin')
    await mkdir(fakeBinDir, { recursive: true })
    const fakeLsofPath = join(fakeBinDir, 'lsof')
    await Bun.write(fakeLsofPath, '#!/bin/sh\necho "$LISTENER_PID"\n')

    const chmod = Bun.spawn(['chmod', '+x', fakeLsofPath], {
      stdout: 'ignore',
      stderr: 'ignore',
      env: { ...process.env },
    })
    await chmod.exited

    const previousPath = process.env.PATH
    const previousListenerPid = process.env.LISTENER_PID
    process.env.PATH = `${fakeBinDir}:${previousPath ?? ''}`
    process.env.LISTENER_PID = String(listenerPid)

    const stalePid = 999_998
    try {
      await registerBackgroundProcess({
        toolCwd: tmpDir,
        pid: stalePid,
        port: 64_433,
        command: 'code serve-web --host=127.0.0.1 --port=64433',
        commandCwd: tmpDir,
        logPath: join(tmpDir, 'port-owner.log'),
        toolName: 'filesystem_bash_coding',
        maxRuntimeSeconds: 60,
      })

      const killResult = await execProcessManager({
        action: 'kill',
        pid: stalePid,
      })
      expect(killResult.isError).toBeUndefined()
      expect(killResult.text).toContain(`PID ${stalePid}`)

      await Bun.sleep(300)
      expect(isPidRunning(listenerPid)).toBe(false)
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = previousPath
      }
      if (previousListenerPid === undefined) {
        delete process.env.LISTENER_PID
      } else {
        process.env.LISTENER_PID = previousListenerPid
      }

      try {
        process.kill(listenerPid, 'SIGKILL')
      } catch {
        // ignore when already stopped
      }
    }
  }, 15_000)
})
