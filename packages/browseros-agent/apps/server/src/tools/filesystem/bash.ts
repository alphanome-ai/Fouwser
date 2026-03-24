import { isAbsolute, relative, resolve } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import {
  DEFAULT_BASH_TIMEOUT,
  executeWithMetrics,
  type FilesystemToolResult,
  toModelOutput,
  truncateTail,
} from './utils'

const TOOL_NAME = 'filesystem_bash'

function isWithinDirectory(baseDir: string, targetPath: string): boolean {
  const relPath = relative(baseDir, targetPath)
  return relPath === '' || (!relPath.startsWith('..') && !isAbsolute(relPath))
}

function getShellArgs(): [string, string] {
  if (process.platform === 'win32') return ['cmd.exe', '/c']
  return [process.env.SHELL || '/bin/sh', '-c']
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

type BashToolParams = {
  command: string
  cwd?: string
  timeout?: number
  background?: boolean
  logFile?: string
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

function resolveBackgroundLogPath(
  commandCwd: string,
  logFile?: string,
): { logPath?: string; error?: string } {
  if (logFile && isAbsolute(logFile)) {
    return { error: 'logFile must be a relative path inside cwd.' }
  }

  const requestedLogFile = logFile || `.browseros-bg-${Date.now()}.log`
  const logPath = resolve(commandCwd, requestedLogFile)
  if (!isWithinDirectory(commandCwd, logPath)) {
    return { error: 'logFile must resolve inside cwd.' }
  }

  return { logPath }
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
  commandCwd: string,
): Promise<FilesystemToolResult> {
  if (process.platform === 'win32') {
    return {
      text: 'Background mode for filesystem_bash is not supported on Windows yet.',
      isError: true,
    }
  }

  const { logPath, error } = resolveBackgroundLogPath(
    commandCwd,
    params.logFile,
  )
  if (error || !logPath)
    return { text: error || 'Invalid logFile.', isError: true }

  const launchCommand = `nohup sh -c ${quoteForShell(params.command)} > ${quoteForShell(logPath)} 2>&1 & echo $!`
  const bgProc = Bun.spawn([shell, flag, launchCommand], {
    cwd: commandCwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })

  const { stdoutText, stderrText, exitCode } = await readProcessOutput(bgProc)

  if (exitCode !== 0) {
    const errorOutput = [stdoutText, stderrText].filter(Boolean).join('\n')
    return {
      text:
        errorOutput ||
        `Failed to start background process (exit code: ${exitCode})`,
      isError: true,
    }
  }

  const pidMatch = stdoutText.trim().match(/\d+/)
  const pidInfo = pidMatch ? `PID: ${pidMatch[0]}\n` : ''
  return {
    text: `Started background command.\nCWD: ${commandCwd}\n${pidInfo}Log: ${logPath}`,
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

export function createBashTool(cwd: string) {
  return tool({
    description:
      'Execute a shell command and return its output. Commands run in a shell (sh/bash on Unix, cmd on Windows). Output is truncated to the last 2000 lines if too large. For long-running commands (e.g. dev servers), use background=true.',
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
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_NAME, async () => {
        const [shell, flag] = getShellArgs()
        const toolCwd = resolve(cwd)
        const commandCwd = resolveCommandCwd(toolCwd, params.cwd)
        const commandParams = params as BashToolParams

        return commandParams.background
          ? runBackgroundCommand(shell, flag, commandParams, commandCwd)
          : runForegroundCommand(shell, flag, commandParams, commandCwd)
      }),
    toModelOutput,
  })
}
