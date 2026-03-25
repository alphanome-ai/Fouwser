import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { getBrowserosDir } from '../../lib/browseros-dir'

export const PROCESS_RUNTIME_DIR = join(getBrowserosDir(), 'proc')
export const DEFAULT_BACKGROUND_MAX_RUNTIME_SECONDS = 30 * 60
const PROCESS_RECORD_EXTENSION = '.json'
const TERMINATION_GRACE_PERIOD_MS = 2_000

interface ManagedProcessRecord {
  pid: number
  port?: number
  command: string
  cwd: string
  logPath: string
  toolName: string
  startedAtMs: number
  expiresAtMs: number
}

export interface ManagedBackgroundProcess {
  pid: number
  logPath: string
  procDir: string
  expiresAtMs: number
  maxRuntimeSeconds: number
  activeCount: number
}

export interface ManagedProcessInfo {
  pid: number
  port?: number
  command: string
  cwd: string
  logPath: string
  toolName: string
  startedAtMs: number
  expiresAtMs: number
  remainingMs: number
}

interface StartManagedBackgroundProcessParams {
  shell: string
  flag: string
  toolCwd: string
  commandCwd: string
  command: string
  logFile?: string
  toolName: string
  maxRuntimeSeconds: number
}

interface ManagedRecordEntry extends ManagedProcessRecord {
  recordPath: string
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function isWithinDirectory(baseDir: string, targetPath: string): boolean {
  const relPath = relative(baseDir, targetPath)
  return relPath === '' || (!relPath.startsWith('..') && !isAbsolute(relPath))
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

async function isProcessRunning(pid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)
  } catch {
    return false
  }

  if (process.platform === 'win32') return true

  try {
    const psProc = Bun.spawn(['ps', '-o', 'stat=', '-p', String(pid)], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    })
    const psOutput = (await new Response(psProc.stdout).text()).trim()
    await psProc.exited
    if (!psOutput || psOutput.startsWith('Z')) return false
  } catch {
    // Ignore ps lookup failures and rely on signal check above.
  }

  return true
}

async function terminateProcess(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return !(await isProcessRunning(pid))
  }

  const deadline = Date.now() + TERMINATION_GRACE_PERIOD_MS
  while (Date.now() < deadline) {
    if (!(await isProcessRunning(pid))) return true
    await Bun.sleep(100)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Ignore and check final state below.
  }

  await Bun.sleep(100)
  return !(await isProcessRunning(pid))
}

function parseRecordFileName(name: string): number | null {
  if (!name.endsWith(PROCESS_RECORD_EXTENSION)) return null
  const pidText = name.slice(0, -PROCESS_RECORD_EXTENSION.length)
  const pid = Number.parseInt(pidText, 10)
  if (!Number.isFinite(pid) || pid <= 0) return null
  return pid
}

function parsePortFromCommand(command: string): number | undefined {
  const match = command.match(/--port(?:=|\s+)(\d{1,5})\b/i)
  if (!match?.[1]) return undefined

  const port = Number.parseInt(match[1], 10)
  if (!Number.isFinite(port) || port < 1 || port > 65_535) return undefined
  return port
}

function parsePidLines(text: string): number[] {
  const pids = new Set<number>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const pid = Number.parseInt(line, 10)
    if (Number.isFinite(pid) && pid > 0) {
      pids.add(pid)
    }
  }
  return [...pids]
}

async function findListeningPidsByPortUnix(port: number): Promise<number[]> {
  try {
    const proc = Bun.spawn(
      ['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env },
      },
    )
    const stdoutText = await new Response(proc.stdout).text()
    await proc.exited
    return parsePidLines(stdoutText)
  } catch {
    return []
  }
}

function parseWindowsNetstatPidsByPort(output: string, port: number): number[] {
  const pids = new Set<number>()
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const parts = line.split(/\s+/)
    if (parts.length < 5) continue
    if (parts[0].toUpperCase() !== 'TCP') continue
    if (parts[3].toUpperCase() !== 'LISTENING') continue

    const localAddress = parts[1]
    const pidText = parts[4]
    const lastColonIndex = localAddress.lastIndexOf(':')
    if (lastColonIndex < 0) continue

    const localPort = Number.parseInt(
      localAddress.slice(lastColonIndex + 1),
      10,
    )
    const pid = Number.parseInt(pidText, 10)
    if (localPort !== port || !Number.isFinite(pid) || pid <= 0) continue
    pids.add(pid)
  }
  return [...pids]
}

async function findListeningPidsByPortWindows(port: number): Promise<number[]> {
  try {
    const proc = Bun.spawn(['netstat', '-ano', '-p', 'tcp'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    })
    const stdoutText = await new Response(proc.stdout).text()
    await proc.exited
    return parseWindowsNetstatPidsByPort(stdoutText, port)
  } catch {
    return []
  }
}

async function findListeningPidsByPort(port: number): Promise<number[]> {
  if (!Number.isFinite(port) || port < 1 || port > 65_535) return []
  if (process.platform === 'win32') {
    return findListeningPidsByPortWindows(port)
  }
  return findListeningPidsByPortUnix(port)
}

function getRecordPort(record: ManagedProcessRecord): number | undefined {
  return record.port ?? parsePortFromCommand(record.command)
}

async function getRecordCandidatePids(
  record: ManagedProcessRecord,
): Promise<number[]> {
  const pids = new Set<number>()
  if (Number.isFinite(record.pid) && record.pid > 0) {
    pids.add(record.pid)
  }

  const port = getRecordPort(record)
  if (port !== undefined) {
    const portPids = await findListeningPidsByPort(port)
    for (const pid of portPids) {
      pids.add(pid)
    }
  }

  return [...pids]
}

async function getRecordActivePids(
  record: ManagedProcessRecord,
): Promise<number[]> {
  const candidates = await getRecordCandidatePids(record)
  const activePids: number[] = []
  for (const pid of candidates) {
    if (await isProcessRunning(pid)) {
      activePids.push(pid)
    }
  }
  return activePids
}

async function readRecord(
  recordPath: string,
): Promise<ManagedProcessRecord | null> {
  try {
    const raw = await Bun.file(recordPath).text()
    const parsed = JSON.parse(raw) as Partial<ManagedProcessRecord>
    if (
      typeof parsed.pid !== 'number' ||
      (parsed.port !== undefined &&
        (typeof parsed.port !== 'number' ||
          !Number.isFinite(parsed.port) ||
          parsed.port < 1 ||
          parsed.port > 65_535)) ||
      typeof parsed.command !== 'string' ||
      typeof parsed.cwd !== 'string' ||
      typeof parsed.logPath !== 'string' ||
      typeof parsed.toolName !== 'string' ||
      typeof parsed.startedAtMs !== 'number' ||
      typeof parsed.expiresAtMs !== 'number'
    ) {
      return null
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      command: parsed.command,
      cwd: parsed.cwd,
      logPath: parsed.logPath,
      toolName: parsed.toolName,
      startedAtMs: parsed.startedAtMs,
      expiresAtMs: parsed.expiresAtMs,
    }
  } catch {
    return null
  }
}

async function collectValidManagedRecords(
  procDir: string,
): Promise<{ records: ManagedRecordEntry[]; removedCount: number }> {
  let entries: string[] = []
  try {
    entries = await readdir(procDir)
  } catch {
    return { records: [], removedCount: 0 }
  }

  let removedCount = 0
  const records: ManagedRecordEntry[] = []
  for (const entry of entries) {
    const pid = parseRecordFileName(entry)
    const recordPath = join(procDir, entry)
    if (!pid) {
      removedCount++
      await rm(recordPath, { force: true }).catch(() => {})
      continue
    }

    const record = await readRecord(recordPath)
    if (!record || record.pid !== pid) {
      removedCount++
      await rm(recordPath, { force: true }).catch(() => {})
      continue
    }

    records.push({ ...record, recordPath })
  }

  records.sort((a, b) => b.startedAtMs - a.startedAtMs)
  return { records, removedCount }
}

function getRecordPath(procDir: string, pid: number): string {
  return join(procDir, `${pid}${PROCESS_RECORD_EXTENSION}`)
}

export function getProcessRuntimeDir(_toolCwd: string): string {
  return PROCESS_RUNTIME_DIR
}

export async function ensureProcessRuntimeDir(
  toolCwd: string,
): Promise<string> {
  const procDir = getProcessRuntimeDir(toolCwd)
  await mkdir(procDir, { recursive: true })
  return procDir
}

export async function cleanupExpiredBackgroundProcesses(
  toolCwd: string,
): Promise<{ procDir: string; activeCount: number; removedCount: number }> {
  const procDir = await ensureProcessRuntimeDir(toolCwd)
  let entries: string[] = []
  try {
    entries = await readdir(procDir)
  } catch {
    return { procDir, activeCount: 0, removedCount: 0 }
  }

  let activeCount = 0
  let removedCount = 0
  const now = Date.now()

  for (const entry of entries) {
    const pid = parseRecordFileName(entry)
    const recordPath = join(procDir, entry)
    if (!pid) {
      removedCount++
      await rm(recordPath, { force: true }).catch(() => {})
      continue
    }

    const record = await readRecord(recordPath)
    if (!record) {
      removedCount++
      await rm(recordPath, { force: true }).catch(() => {})
      continue
    }

    if (record.pid !== pid) {
      removedCount++
      await rm(recordPath, { force: true }).catch(() => {})
      continue
    }

    const activePids = await getRecordActivePids(record)
    if (activePids.length === 0) {
      removedCount++
      await rm(recordPath, { force: true }).catch(() => {})
      continue
    }

    if (record.expiresAtMs <= now) {
      for (const activePid of activePids) {
        await terminateProcess(activePid)
      }
      const remainingPids = await getRecordActivePids(record)
      if (remainingPids.length === 0) {
        removedCount++
        await rm(recordPath, { force: true }).catch(() => {})
      } else {
        activeCount++
      }
      continue
    }

    activeCount++
  }

  return { procDir, activeCount, removedCount }
}

export async function runProcessRuntimeMaintenance(
  toolCwd: string,
): Promise<{ procDir: string; activeCount: number; removedCount: number }> {
  await pruneStaleProcessRuntimeEntries(toolCwd)
  return cleanupExpiredBackgroundProcesses(toolCwd)
}

export async function listManagedBackgroundProcesses(toolCwd: string): Promise<{
  procDir: string
  activeCount: number
  removedCount: number
  processes: ManagedProcessInfo[]
}> {
  const maintenance = await runProcessRuntimeMaintenance(toolCwd)
  const { records, removedCount: invalidRemoved } =
    await collectValidManagedRecords(maintenance.procDir)

  let removedCount = maintenance.removedCount + invalidRemoved
  const now = Date.now()
  const processes: ManagedProcessInfo[] = []

  for (const record of records) {
    const activePids = await getRecordActivePids(record)
    if (activePids.length === 0) {
      removedCount++
      await rm(record.recordPath, { force: true }).catch(() => {})
      continue
    }
    processes.push({
      pid: record.pid,
      port: record.port,
      command: record.command,
      cwd: record.cwd,
      logPath: record.logPath,
      toolName: record.toolName,
      startedAtMs: record.startedAtMs,
      expiresAtMs: record.expiresAtMs,
      remainingMs: Math.max(0, record.expiresAtMs - now),
    })
  }

  return {
    procDir: maintenance.procDir,
    activeCount: processes.length,
    removedCount,
    processes,
  }
}

export async function killManagedBackgroundProcess(params: {
  toolCwd: string
  pid: number
}): Promise<{
  procDir: string
  recordFound: boolean
  wasRunning: boolean
  killed: boolean
}> {
  const procDir = await ensureProcessRuntimeDir(params.toolCwd)
  const recordPath = getRecordPath(procDir, params.pid)
  const record = await readRecord(recordPath)
  if (!record) {
    return {
      procDir,
      recordFound: false,
      wasRunning: false,
      killed: false,
    }
  }

  const activePids = await getRecordActivePids(record)
  const wasRunning = activePids.length > 0

  for (const pid of activePids) {
    await terminateProcess(pid)
  }
  const remainingPids = await getRecordActivePids(record)
  const killed = remainingPids.length === 0
  if (killed) {
    await rm(recordPath, { force: true }).catch(() => {})
  }

  return {
    procDir,
    recordFound: true,
    wasRunning,
    killed,
  }
}

export async function killManagedBackgroundProcesses(params: {
  toolCwd: string
  toolName?: string
  cwd?: string
  commandContains?: string
}): Promise<{
  procDir: string
  matched: number
  killed: number
  failed: number
  remainingActive: number
}> {
  const listed = await listManagedBackgroundProcesses(params.toolCwd)
  const commandFilter = params.commandContains?.trim().toLowerCase()
  const filtered = listed.processes.filter((process) => {
    if (params.toolName && process.toolName !== params.toolName) return false
    if (params.cwd && process.cwd !== params.cwd) return false
    if (
      commandFilter &&
      !process.command.toLowerCase().includes(commandFilter)
    ) {
      return false
    }
    return true
  })

  let killed = 0
  let failed = 0
  for (const process of filtered) {
    const result = await killManagedBackgroundProcess({
      toolCwd: params.toolCwd,
      pid: process.pid,
    })
    if (result.killed) killed++
    else failed++
  }

  const remaining = await listManagedBackgroundProcesses(params.toolCwd)
  return {
    procDir: listed.procDir,
    matched: filtered.length,
    killed,
    failed,
    remainingActive: remaining.activeCount,
  }
}

export async function registerBackgroundProcess(params: {
  toolCwd: string
  pid: number
  port?: number
  command: string
  commandCwd: string
  logPath: string
  toolName: string
  maxRuntimeSeconds: number
}): Promise<{ procDir: string; recordPath: string; expiresAtMs: number }> {
  const procDir = await ensureProcessRuntimeDir(params.toolCwd)
  const startedAtMs = Date.now()
  const expiresAtMs =
    startedAtMs + Math.max(1, Math.floor(params.maxRuntimeSeconds)) * 1000

  const record: ManagedProcessRecord = {
    pid: params.pid,
    port: params.port ?? parsePortFromCommand(params.command),
    command: params.command,
    cwd: params.commandCwd,
    logPath: params.logPath,
    toolName: params.toolName,
    startedAtMs,
    expiresAtMs,
  }

  const recordPath = getRecordPath(procDir, params.pid)
  await Bun.write(recordPath, JSON.stringify(record, null, 2))

  return { procDir, recordPath, expiresAtMs }
}

export function resolveBackgroundLogPath(params: {
  commandCwd: string
  logFile?: string
}): { logPath?: string; error?: string } {
  if (params.logFile && isAbsolute(params.logFile)) {
    return { error: 'logFile must be a relative path inside cwd.' }
  }

  const requestedLogFile = params.logFile || `.browseros-bg-${Date.now()}.log`
  const logPath = resolve(params.commandCwd, requestedLogFile)
  if (!isWithinDirectory(params.commandCwd, logPath)) {
    return { error: 'logFile must resolve inside cwd.' }
  }

  return { logPath }
}

export async function removeBackgroundProcessRecord(params: {
  toolCwd: string
  pid: number
}): Promise<void> {
  const procDir = getProcessRuntimeDir(params.toolCwd)
  const recordPath = getRecordPath(procDir, params.pid)
  await rm(recordPath, { force: true }).catch(() => {})
}

export async function startManagedBackgroundProcess(
  params: StartManagedBackgroundProcessParams,
): Promise<{ process?: ManagedBackgroundProcess; error?: string }> {
  const maxRuntimeSeconds = Math.max(1, Math.floor(params.maxRuntimeSeconds))
  const { logPath, error } = resolveBackgroundLogPath({
    commandCwd: params.commandCwd,
    logFile: params.logFile,
  })
  if (error || !logPath) {
    return { error: error || 'Invalid logFile.' }
  }

  const launchCommand = buildBackgroundLaunchCommand({
    command: params.command,
    logPath,
    maxRuntimeSeconds,
  })
  const bgProc = Bun.spawn([params.shell, params.flag, launchCommand], {
    cwd: params.commandCwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })
  const { stdoutText, stderrText, exitCode } = await readProcessOutput(bgProc)
  if (exitCode !== 0) {
    const errorOutput = [stdoutText, stderrText].filter(Boolean).join('\n')
    return {
      error:
        errorOutput ||
        `Failed to start background process (exit code: ${exitCode})`,
    }
  }

  const pidMatch = stdoutText.trim().match(/\d+/)
  const pid = pidMatch ? Number.parseInt(pidMatch[0], 10) : undefined
  if (!pid) {
    return {
      error: `Background command started but PID could not be determined.\nCWD: ${params.commandCwd}\nLog: ${logPath}`,
    }
  }

  const { procDir, expiresAtMs } = await registerBackgroundProcess({
    toolCwd: params.toolCwd,
    pid,
    command: params.command,
    commandCwd: params.commandCwd,
    logPath,
    toolName: params.toolName,
    maxRuntimeSeconds,
  })
  const { activeCount } = await cleanupExpiredBackgroundProcesses(
    params.toolCwd,
  )

  return {
    process: {
      pid,
      logPath,
      procDir,
      expiresAtMs,
      maxRuntimeSeconds,
      activeCount,
    },
  }
}

export function buildBackgroundLaunchCommand(params: {
  command: string
  logPath: string
  maxRuntimeSeconds: number
}): string {
  const ttl = Math.max(1, Math.floor(params.maxRuntimeSeconds))
  const innerCommand = [
    `sh -c ${quoteForShell(params.command)} &`,
    'cmd_pid=$!',
    'trap \'kill -TERM "$cmd_pid" 2>/dev/null\' TERM INT',
    `(`,
    `  sleep ${ttl}`,
    '  kill -TERM "$cmd_pid" 2>/dev/null',
    '  sleep 2',
    '  kill -KILL "$cmd_pid" 2>/dev/null',
    `) &`,
    'watchdog_pid=$!',
    'wait "$cmd_pid"',
    'exit_code=$?',
    'kill "$watchdog_pid" 2>/dev/null',
    'exit "$exit_code"',
  ].join('\n')

  return `nohup sh -c ${quoteForShell(innerCommand)} > ${quoteForShell(params.logPath)} 2>&1 < /dev/null & echo $!`
}

export async function pruneStaleProcessRuntimeEntries(
  toolCwd: string,
): Promise<void> {
  const procDir = await ensureProcessRuntimeDir(toolCwd)
  let entries: string[] = []
  try {
    entries = await readdir(procDir)
  } catch {
    return
  }

  const now = Date.now()
  for (const entry of entries) {
    const recordPath = join(procDir, entry)
    const info = await stat(recordPath).catch(() => null)
    if (!info?.isFile()) continue
    // Keep records for at most 7 days after file mtime.
    if (info.mtimeMs + 7 * 24 * 60 * 60 * 1000 < now) {
      await rm(recordPath, { force: true }).catch(() => {})
    }
  }
}

export async function verifyProcessStartup(params: {
  pid: number
  logPath: string
  startupDelayMs?: number
}): Promise<{ running: boolean; logTail?: string }> {
  await Bun.sleep(params.startupDelayMs ?? 400)
  const running = await isProcessRunning(params.pid)
  if (running) return { running: true }

  try {
    const content = await Bun.file(params.logPath).text()
    return { running: false, logTail: content }
  } catch {
    return { running: false, logTail: '(no log output)' }
  }
}
