import { resolve } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import {
  killManagedBackgroundProcess,
  killManagedBackgroundProcesses,
  listManagedBackgroundProcesses,
  runProcessRuntimeMaintenance,
} from './process-runtime'
import { executeWithMetrics, toModelOutput } from './utils'

const TOOL_NAME = 'filesystem_process_manager'

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatProcessListResult(params: {
  procDir: string
  activeCount: number
  removedCount: number
  processes: Array<{
    pid: number
    port?: number
    toolName: string
    remainingMs: number
    cwd: string
    command: string
    logPath: string
  }>
}): string {
  const header = [
    `Process registry: ${params.procDir}`,
    `Active managed processes: ${params.activeCount}`,
    `Stale/expired records removed: ${params.removedCount}`,
  ]

  if (params.processes.length === 0) {
    return `${header.join('\n')}\n\n(no managed background processes)`
  }

  const lines = params.processes.map((process, index) =>
    [
      `${index + 1}. PID ${process.pid}${process.port ? ` | port=${process.port}` : ''} | tool=${process.toolName} | expires in ${formatDuration(process.remainingMs)}`,
      `   cwd: ${process.cwd}`,
      `   log: ${process.logPath}`,
      `   cmd: ${process.command}`,
    ].join('\n'),
  )
  return `${header.join('\n')}\n\n${lines.join('\n')}`
}

function formatCleanupResult(params: {
  procDir: string
  activeCount: number
  removedCount: number
}): string {
  return [
    `Process registry: ${params.procDir}`,
    `Active managed processes: ${params.activeCount}`,
    `Removed stale/expired records: ${params.removedCount}`,
  ].join('\n')
}

async function executeListAction(toolCwd: string) {
  const listed = await listManagedBackgroundProcesses(toolCwd)
  return { text: formatProcessListResult(listed) }
}

async function executeCleanupAction(toolCwd: string) {
  const cleaned = await runProcessRuntimeMaintenance(toolCwd)
  return { text: formatCleanupResult(cleaned) }
}

async function executeKillAction(toolCwd: string, pid: number) {
  const result = await killManagedBackgroundProcess({ toolCwd, pid })
  if (!result.recordFound) {
    return {
      text: `No managed process record found for PID ${pid} in ${result.procDir}.`,
    }
  }
  if (result.killed) {
    return {
      text: result.wasRunning
        ? `Killed managed process PID ${pid} and removed its record.`
        : `Managed process PID ${pid} was already stopped; removed its record.`,
    }
  }
  return {
    text: `Failed to terminate managed process PID ${pid}. Record was kept for retry.`,
    isError: true,
  }
}

async function executeKillAllAction(params: {
  toolCwd: string
  toolName?: string
  cwd?: string
  commandContains?: string
}) {
  const resolvedCwd = params.cwd
    ? resolve(params.toolCwd, params.cwd)
    : undefined
  const result = await killManagedBackgroundProcesses({
    toolCwd: params.toolCwd,
    toolName: params.toolName,
    cwd: resolvedCwd,
    commandContains: params.commandContains,
  })

  const filterParts = [
    params.toolName ? `tool=${params.toolName}` : undefined,
    resolvedCwd ? `cwd=${resolvedCwd}` : undefined,
    params.commandContains
      ? `command contains "${params.commandContains}"`
      : undefined,
  ].filter(Boolean)

  return {
    text: [
      `Process registry: ${result.procDir}`,
      `Matched managed processes: ${result.matched}${
        filterParts.length ? ` (${filterParts.join(', ')})` : ''
      }`,
      `Killed: ${result.killed}`,
      `Failed: ${result.failed}`,
      `Remaining active managed processes: ${result.remainingActive}`,
    ].join('\n'),
    isError: result.failed > 0 ? true : undefined,
  }
}

export function createProcessManagerTool(cwd: string) {
  return tool({
    description:
      'Manage background processes tracked under .fouwser/proc. Supports listing managed processes, cleanup of expired/stale records, killing one tracked process by PID, and killing matching/all tracked processes.',
    inputSchema: z
      .object({
        action: z
          .enum(['list', 'cleanup', 'kill', 'kill_all'])
          .describe('Management action to perform.'),
        pid: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('PID to kill when action="kill".'),
        toolName: z
          .string()
          .optional()
          .describe('Optional filter for action="kill_all".'),
        cwd: z
          .string()
          .optional()
          .describe('Optional exact cwd filter for action="kill_all".'),
        commandContains: z
          .string()
          .optional()
          .describe('Optional command substring filter for action="kill_all".'),
      })
      .superRefine((value, ctx) => {
        if (value.action === 'kill' && value.pid === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['pid'],
            message: 'pid is required when action is "kill".',
          })
        }
      }),
    execute: (params) =>
      executeWithMetrics(TOOL_NAME, async () => {
        const toolCwd = resolve(cwd)

        if (params.action === 'list') return executeListAction(toolCwd)
        if (params.action === 'cleanup') return executeCleanupAction(toolCwd)
        if (params.action === 'kill') {
          return executeKillAction(toolCwd, params.pid as number)
        }

        return executeKillAllAction({
          toolCwd,
          toolName: params.toolName,
          cwd: params.cwd,
          commandContains: params.commandContains,
        })
      }),
    toModelOutput,
  })
}
