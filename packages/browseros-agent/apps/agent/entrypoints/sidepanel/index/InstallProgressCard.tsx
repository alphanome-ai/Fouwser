import {
  CheckCircle2,
  Download,
  Loader2,
  PackageX,
  Terminal,
} from 'lucide-react'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type {
  ToolInvocationInfo,
  ToolInvocationState,
} from './getMessageSegments'

type DownloadDescriptor = {
  actionLabel: 'Installing' | 'Downloading'
  title: string
  subtitle?: string
  command?: string
}

const COMMAND_TOOLS = new Set(['filesystem_bash', 'filesystem_bash_coding'])
const DOWNLOAD_TOOLS = new Set(['download_file'])

const PACKAGE_MANAGER_PATTERNS: Array<{
  name: string
  regex: RegExp
}> = [
  { name: 'npm', regex: /\bnpm\s+(?:install|i|add)\b/i },
  { name: 'pnpm', regex: /\bpnpm\s+(?:install|add)\b/i },
  { name: 'yarn', regex: /\byarn\s+(?:add|install)\b/i },
  { name: 'bun', regex: /\bbun\s+(?:add|install)\b/i },
  { name: 'pip', regex: /\bpip(?:3)?\s+install\b/i },
  { name: 'brew', regex: /\bbrew\s+install\b/i },
  { name: 'apt', regex: /\bapt(?:-get)?\s+install\b/i },
  { name: 'winget', regex: /\bwinget\s+install\b/i },
  { name: 'choco', regex: /\bchoco\s+install\b/i },
  { name: 'dnf', regex: /\bdnf\s+install\b/i },
  { name: 'pacman', regex: /\bpacman\s+-S\b/i },
  { name: 'snap', regex: /\bsnap\s+install\b/i },
  { name: 'cargo', regex: /\bcargo\s+install\b/i },
  { name: 'go', regex: /\bgo\s+install\b/i },
  { name: 'gem', regex: /\bgem\s+install\b/i },
  { name: 'composer', regex: /\bcomposer\s+require\b/i },
]

const DOWNLOAD_COMMAND_PATTERN =
  /\b(download|curl\s+-[^\n]*[oO]|wget\b|invoke-webrequest)\b/i

const RUNNING_STATES = new Set<ToolInvocationState>([
  'partial-call',
  'call',
  'input-streaming',
  'input-available',
])

const SUCCESS_STATES = new Set<ToolInvocationState>([
  'result',
  'output-available',
])

function stripQuoted(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

function getCommand(tool: ToolInvocationInfo): string {
  const command = tool.input?.command
  return typeof command === 'string' ? command.trim() : ''
}

function getPackageManager(command: string): string | null {
  for (const each of PACKAGE_MANAGER_PATTERNS) {
    if (each.regex.test(command)) return each.name
  }
  return null
}

function getInstallTarget(
  command: string,
  manager: string | null,
): string | null {
  if (!manager) return null

  const patterns: Record<string, RegExp[]> = {
    npm: [/\bnpm\s+(?:install|i|add)\s+([^\s;&|]+)/i],
    pnpm: [/\bpnpm\s+(?:install|add)\s+([^\s;&|]+)/i],
    yarn: [/\byarn\s+(?:add|install)\s+([^\s;&|]+)/i],
    bun: [/\bbun\s+(?:add|install)\s+([^\s;&|]+)/i],
    pip: [/\bpip(?:3)?\s+install\s+([^\s;&|]+)/i],
    brew: [/\bbrew\s+install(?:\s+--cask)?\s+([^\s;&|]+)/i],
    apt: [/\bapt(?:-get)?\s+install(?:\s+-\S+)*\s+([^\s;&|]+)/i],
    winget: [
      /\bwinget\s+install(?:\s+[^\n]*?)\s+--id\s+([^\s;&|]+)/i,
      /\bwinget\s+install\s+([^\s;&|]+)/i,
    ],
    choco: [/\bchoco\s+install\s+([^\s;&|]+)/i],
    dnf: [/\bdnf\s+install(?:\s+-\S+)*\s+([^\s;&|]+)/i],
    pacman: [/\bpacman\s+-S(?:\s+--\S+)*\s+([^\s;&|]+)/i],
    snap: [/\bsnap\s+install\s+([^\s;&|]+)/i],
    cargo: [/\bcargo\s+install\s+([^\s;&|]+)/i],
    go: [/\bgo\s+install\s+([^\s;&|]+)/i],
    gem: [/\bgem\s+install\s+([^\s;&|]+)/i],
    composer: [/\bcomposer\s+require\s+([^\s;&|]+)/i],
  }

  const candidates = patterns[manager] ?? []
  for (const pattern of candidates) {
    const match = command.match(pattern)
    if (match?.[1]) return stripQuoted(match[1])
  }
  return null
}

function outputToText(output: unknown): string {
  if (typeof output === 'string') return output
  if (!output || typeof output !== 'object') return ''

  const shaped = output as {
    type?: string
    value?: unknown
    content?: Array<{ type?: string; text?: string }>
  }

  if (typeof shaped.value === 'string') return shaped.value

  if (shaped.type === 'content' && Array.isArray(shaped.value)) {
    const textChunk = shaped.value.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'type' in entry &&
        'text' in entry &&
        (entry as { type?: string }).type === 'text',
    ) as { text?: string } | undefined
    return textChunk?.text ?? ''
  }

  if (Array.isArray(shaped.content)) {
    return shaped.content
      .filter(
        (chunk) => chunk?.type === 'text' && typeof chunk.text === 'string',
      )
      .map((chunk) => chunk.text)
      .join('\n')
  }

  return ''
}

function extractPercentFromText(text: string): number | null {
  if (!text) return null
  const matches = [...text.matchAll(/\b(100|[1-9]?\d)%\b/g)]
  if (matches.length === 0) return null
  const lastMatch = matches[matches.length - 1]?.[1]
  if (!lastMatch) return null
  const parsed = Number(lastMatch)
  if (Number.isNaN(parsed)) return null
  return Math.max(0, Math.min(100, parsed))
}

function extractPercentFromInput(
  input: Record<string, unknown>,
): number | null {
  const progress = input.progress
  if (typeof progress !== 'number' || Number.isNaN(progress)) return null
  return Math.max(0, Math.min(100, Math.round(progress)))
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function truncateCommand(command: string, maxLength = 96): string {
  if (command.length <= maxLength) return command
  return `${command.slice(0, maxLength - 1)}...`
}

function getDescriptor(tool: ToolInvocationInfo): DownloadDescriptor | null {
  if (DOWNLOAD_TOOLS.has(tool.toolName)) {
    const path = typeof tool.input?.path === 'string' ? tool.input.path : ''
    return {
      actionLabel: 'Downloading',
      title: 'Downloading file',
      subtitle: path ? `Saving to ${path}` : undefined,
    }
  }

  if (!COMMAND_TOOLS.has(tool.toolName)) return null
  const command = getCommand(tool)
  if (!command) return null

  const hasDownloadKeyword = DOWNLOAD_COMMAND_PATTERN.test(command)
  const packageManager = getPackageManager(command)
  const installTarget = getInstallTarget(command, packageManager)

  if (!hasDownloadKeyword && !packageManager) return null

  if (packageManager) {
    const managerDisplay = toTitleCase(packageManager)
    return {
      actionLabel: 'Installing',
      title: installTarget
        ? `Installing ${installTarget}`
        : `Installing with ${managerDisplay}`,
      subtitle: managerDisplay,
      command,
    }
  }

  return {
    actionLabel: 'Downloading',
    title: 'Downloading via shell command',
    command,
  }
}

export function isDownloadProgressTool(tool: ToolInvocationInfo): boolean {
  return getDescriptor(tool) !== null
}

interface InstallProgressCardProps {
  tool: ToolInvocationInfo
}

export const InstallProgressCard: FC<InstallProgressCardProps> = ({ tool }) => {
  const descriptor = useMemo(() => getDescriptor(tool), [tool])
  const startRef = useRef(Date.now())
  const [, setTick] = useState(0)

  const isRunning = RUNNING_STATES.has(tool.state)
  const isSuccess = SUCCESS_STATES.has(tool.state)
  const isError = tool.state === 'output-error'

  useEffect(() => {
    if (!isRunning) return
    const timer = setInterval(() => {
      setTick((value) => value + 1)
    }, 450)
    return () => clearInterval(timer)
  }, [isRunning])

  if (!descriptor) return null

  const outputText = outputToText(tool.output)
  const parsedPercent = extractPercentFromText(outputText)
  const inputPercent = extractPercentFromInput(tool.input)
  const stageMessage =
    typeof tool.input.message === 'string' ? tool.input.message : null
  const elapsedSeconds = (Date.now() - startRef.current) / 1000
  const estimatedRunningProgress = Math.min(
    92,
    Math.round(12 + 80 * (1 - Math.exp(-elapsedSeconds / 16))),
  )

  const value = isSuccess
    ? 100
    : isError
      ? Math.max(parsedPercent ?? 0, 2)
      : (parsedPercent ?? Math.max(inputPercent ?? 0, estimatedRunningProgress))

  const statusText = isSuccess
    ? `${descriptor.actionLabel} complete`
    : isError
      ? `${descriptor.actionLabel} failed`
      : `${descriptor.actionLabel} in progress`

  const Icon = isSuccess ? CheckCircle2 : isError ? PackageX : Loader2

  const progressClassName = isError
    ? 'bg-destructive/20 [&_[data-slot=progress-indicator]]:bg-destructive'
    : isSuccess
      ? 'bg-emerald-500/20 [&_[data-slot=progress-indicator]]:bg-emerald-500'
      : 'bg-primary/20'

  return (
    <div className="rounded-lg border border-border/50 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-muted p-1.5">
          {descriptor.actionLabel === 'Downloading' ? (
            <Download className="h-4 w-4 text-[var(--accent-orange)]" />
          ) : (
            <Terminal className="h-4 w-4 text-[var(--accent-orange)]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{descriptor.title}</p>
          {descriptor.subtitle ? (
            <p className="mt-0.5 text-muted-foreground text-xs">
              {descriptor.subtitle}
            </p>
          ) : null}
          {stageMessage ? (
            <p className="mt-0.5 text-muted-foreground text-xs">
              {stageMessage}
            </p>
          ) : null}
          {descriptor.command ? (
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
              {truncateCommand(descriptor.command)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span
            className={cn(
              'flex items-center gap-1.5',
              isError ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            <Icon
              className={cn('h-3.5 w-3.5', isRunning ? 'animate-spin' : '')}
            />
            {statusText}
          </span>
          <span className="tabular-nums">{value}%</span>
        </div>
        <Progress className={progressClassName} value={value} />
      </div>
    </div>
  )
}
