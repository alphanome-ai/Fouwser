import { resolve } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import {
  DEFAULT_BACKGROUND_MAX_RUNTIME_SECONDS,
  removeBackgroundProcessRecord,
  runProcessRuntimeMaintenance,
  startManagedBackgroundProcess,
  verifyProcessStartup,
} from './process-runtime'
import {
  DEFAULT_BASH_TIMEOUT,
  executeWithMetrics,
  type FilesystemToolResult,
  toModelOutput,
  truncateTail,
} from './utils'

const TOOL_NAME = 'filesystem_bash_coding'

function getShellArgs(): [string, string] {
  if (process.platform === 'win32') return ['cmd.exe', '/c']
  return [process.env.SHELL || '/bin/sh', '-c']
}

type BashToolParams = {
  command: string
  cwd?: string
  timeout?: number
  background?: boolean
  logFile?: string
  expectLongRunning?: boolean
  maxRuntimeSeconds?: number
}

function combineOutput(stdoutText: string, stderrText: string): string {
  let output = stdoutText
  if (stderrText) output += (output ? '\n' : '') + stderrText
  return output
}

async function readProcessOutput(
  proc: ReturnType<typeof Bun.spawn>,
): Promise<{ stdoutText: string; stderrText: string; exitCode: number }> {
  const readText = async (
    stream: ReturnType<typeof Bun.spawn>['stdout'],
  ): Promise<string> => {
    if (!stream || typeof stream === 'number') return ''
    return new Response(stream).text()
  }

  const [stdoutText, stderrText] = await Promise.all([
    readText(proc.stdout),
    readText(proc.stderr),
  ])
  const exitCode = await proc.exited
  return { stdoutText, stderrText, exitCode }
}

async function readProcessOutputWithTimeout(
  proc: ReturnType<typeof Bun.spawn>,
  timeoutMs: number,
): Promise<{
  stdoutText: string
  stderrText: string
  exitCode: number
  timedOut: boolean
}> {
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutMs)

  const { stdoutText, stderrText, exitCode } = await readProcessOutput(proc)
  clearTimeout(timer)

  return { stdoutText, stderrText, exitCode, timedOut }
}

function resolveCommandCwd(toolCwd: string, requestedCwd?: string): string {
  return requestedCwd ? resolve(toolCwd, requestedCwd) : toolCwd
}

function formatForegroundOutput(output: string): string {
  const truncated = truncateTail(output)
  if (truncated.truncated) {
    return `(Output truncated. Showing last ${truncated.keptLines} of ${truncated.totalLines} lines)\n${truncated.content}`
  }
  return truncated.content
}

async function runBackgroundCommand(
  shell: string,
  flag: string,
  params: BashToolParams,
  toolCwd: string,
  commandCwd: string,
): Promise<FilesystemToolResult> {
  if (process.platform === 'win32') {
    return {
      text: 'Background mode for filesystem_bash_coding is not supported on Windows yet.',
      isError: true,
    }
  }

  const { process: managedProcess, error } =
    await startManagedBackgroundProcess({
      shell,
      flag,
      toolCwd,
      commandCwd,
      command: params.command,
      logFile: params.logFile,
      toolName: TOOL_NAME,
      maxRuntimeSeconds:
        params.maxRuntimeSeconds ?? DEFAULT_BACKGROUND_MAX_RUNTIME_SECONDS,
    })
  if (error || !managedProcess) {
    return { text: error || 'Unknown error.', isError: true }
  }

  const shouldVerifyLongRunning = params.expectLongRunning !== false
  if (shouldVerifyLongRunning) {
    const startupCheck = await verifyProcessStartup({
      pid: managedProcess.pid,
      logPath: managedProcess.logPath,
      startupDelayMs: 400,
    })
    if (!startupCheck.running) {
      await removeBackgroundProcessRecord({
        toolCwd,
        pid: managedProcess.pid,
      })
      const logTail =
        truncateTail(startupCheck.logTail ?? '(no log output)').content ||
        '(no log output)'

      return {
        text: `Background process exited during startup.\nCWD: ${commandCwd}\nPID: ${managedProcess.pid}\nLog: ${managedProcess.logPath}\n\nStartup log tail:\n${logTail}`,
        isError: true,
      }
    }
  }

  return {
    text: `Started background command.\nCWD: ${commandCwd}\nPID: ${managedProcess.pid}\nMax runtime: ${managedProcess.maxRuntimeSeconds}s\nExpires at: ${new Date(managedProcess.expiresAtMs).toISOString()}\nProcess registry: ${managedProcess.procDir}\nManaged background processes: ${managedProcess.activeCount}\nLog: ${managedProcess.logPath}`,
  }
}

async function runForegroundCommand(
  shell: string,
  flag: string,
  params: BashToolParams,
  commandCwd: string,
): Promise<FilesystemToolResult> {
  const timeoutSeconds = params.timeout || DEFAULT_BASH_TIMEOUT
  const timeoutMs = timeoutSeconds * 1000
  const proc = Bun.spawn([shell, flag, params.command], {
    cwd: commandCwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })

  const { stdoutText, stderrText, exitCode, timedOut } =
    await readProcessOutputWithTimeout(proc, timeoutMs)

  if (timedOut) {
    const output = combineOutput(stdoutText, stderrText)
    const truncated = truncateTail(output)
    return {
      text: `Command timed out after ${timeoutSeconds}s\n\n${truncated.content}`,
      isError: true,
    }
  }

  let result = formatForegroundOutput(combineOutput(stdoutText, stderrText))
  if (exitCode !== 0) {
    result += `\n\n[Exit code: ${exitCode}]`
    return { text: result, isError: true }
  }

  return { text: result || '(no output)' }
}

export function createBashCodingTool(cwd: string) {
  return tool({
    description:
      'Execute a shell command for coding workflows and return its output. Commands run in a shell (sh/bash on Unix, cmd on Windows). Output is truncated to the last 2000 lines if too large. For long-running commands (e.g. dev servers), use background=true and expectLongRunning=true.',
    inputSchema: z.object({
      command: z.string().describe('Shell command to execute'),
      cwd: z
        .string()
        .optional()
        .describe(
          'Working directory for command execution (relative to tool cwd or absolute path).',
        ),
      timeout: z
        .number()
        .optional()
        .describe(`Timeout in seconds (default: ${DEFAULT_BASH_TIMEOUT})`),
      background: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'Run command as a background process (recommended for dev/prod servers).',
        ),
      logFile: z
        .string()
        .optional()
        .describe(
          'Log file path for background mode. Must be a relative path inside cwd. Defaults to a generated .browseros-bg-*.log file.',
        ),
      maxRuntimeSeconds: z
        .number()
        .optional()
        .describe(
          `Maximum allowed runtime for background commands in seconds (default: ${DEFAULT_BACKGROUND_MAX_RUNTIME_SECONDS}). Expired processes are terminated and removed from .fouwser/proc.`,
        ),
      expectLongRunning: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'When true in background mode, verify the process is still running shortly after startup. Enabled by default for coding tasks.',
        ),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_NAME, async () => {
        const [shell, flag] = getShellArgs()
        const toolCwd = resolve(cwd)
        const commandCwd = resolveCommandCwd(toolCwd, params.cwd)
        const commandParams = params as BashToolParams

        if (process.platform !== 'win32')
          await runProcessRuntimeMaintenance(toolCwd)

        return commandParams.background
          ? runBackgroundCommand(
              shell,
              flag,
              commandParams,
              toolCwd,
              commandCwd,
            )
          : runForegroundCommand(shell, flag, commandParams, commandCwd)
      }),
    toModelOutput,
  })
}
