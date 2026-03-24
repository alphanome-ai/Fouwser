import { existsSync } from 'node:fs'
import { logger } from '../logger'

type InstallStrategy = {
  name: string
  command: string[]
}

type CommandResult = {
  exitCode: number
  output: string
}

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000
const MAX_FAILURE_SNIPPET = 240

let verificationPromise: Promise<void> | null = null

function isVsCodeInstalled(): boolean {
  if (Bun.which('code')) return true
  if (process.platform === 'darwin') {
    return existsSync('/Applications/Visual Studio Code.app')
  }
  return false
}

function hasCommand(name: string): boolean {
  return Bun.which(name) !== null
}

function getInstallStrategies(): InstallStrategy[] {
  switch (process.platform) {
    case 'darwin':
      return hasCommand('brew')
        ? [
            {
              name: 'brew-cask',
              command: ['brew', 'install', '--cask', 'visual-studio-code'],
            },
          ]
        : []
    case 'win32':
      if (hasCommand('winget')) {
        return [
          {
            name: 'winget',
            command: [
              'winget',
              'install',
              '--id',
              'Microsoft.VisualStudioCode',
              '-e',
              '--accept-package-agreements',
              '--accept-source-agreements',
            ],
          },
        ]
      }
      if (hasCommand('choco')) {
        return [
          {
            name: 'choco',
            command: ['choco', 'install', 'vscode', '-y'],
          },
        ]
      }
      return []
    default: {
      const strategies: InstallStrategy[] = []
      if (hasCommand('apt-get')) {
        strategies.push({
          name: 'apt-get',
          command: ['sudo', '-n', 'apt-get', 'install', '-y', 'code'],
        })
      }
      if (hasCommand('snap')) {
        strategies.push({
          name: 'snap',
          command: ['sudo', '-n', 'snap', 'install', 'code', '--classic'],
        })
      }
      if (hasCommand('dnf')) {
        strategies.push({
          name: 'dnf',
          command: ['sudo', '-n', 'dnf', 'install', '-y', 'code'],
        })
      }
      if (hasCommand('pacman')) {
        strategies.push({
          name: 'pacman',
          command: ['sudo', '-n', 'pacman', '-S', '--noconfirm', 'code'],
        })
      }
      return strategies
    }
  }
}

async function runCommand(command: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, INSTALL_TIMEOUT_MS)

  const [stdoutText, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  clearTimeout(timer)

  const output = [stdoutText, stderrText].filter(Boolean).join('\n').trim()
  if (timedOut) {
    return {
      exitCode: exitCode ?? 1,
      output:
        output || `Install command timed out after ${INSTALL_TIMEOUT_MS}ms.`,
    }
  }

  return { exitCode: exitCode ?? 1, output }
}

async function ensureVsCodeInstalledInner(): Promise<void> {
  if (isVsCodeInstalled()) return

  const strategies = getInstallStrategies()
  if (strategies.length === 0) {
    throw new Error(
      'VS Code is required for coding mode but no supported installer (brew/winget/choco/apt-get/snap/dnf/pacman) is available on this system.',
    )
  }

  logger.warn('VS Code not found. Attempting automatic installation.', {
    platform: process.platform,
    strategies: strategies.map((s) => s.name),
  })

  const failures: string[] = []
  for (const strategy of strategies) {
    const result = await runCommand(strategy.command)
    if (result.exitCode === 0 && isVsCodeInstalled()) {
      logger.info('VS Code installed successfully.', {
        strategy: strategy.name,
      })
      return
    }

    const snippet = result.output.slice(0, MAX_FAILURE_SNIPPET)
    failures.push(
      `${strategy.name} failed (exit ${result.exitCode})${snippet ? `: ${snippet}` : ''}`,
    )
  }

  throw new Error(
    `VS Code is required for coding mode and automatic installation failed. ${failures.join(' | ')}`,
  )
}

export async function ensureVsCodeInstalledForCoding(): Promise<void> {
  if (isVsCodeInstalled()) return
  if (verificationPromise) return verificationPromise

  verificationPromise = ensureVsCodeInstalledInner().finally(() => {
    verificationPromise = null
  })
  return verificationPromise
}
