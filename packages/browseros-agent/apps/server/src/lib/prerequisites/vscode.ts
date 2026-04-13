import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../logger'

type InstallStrategy = {
  name: string
  command: string[]
  verifyCommand?: string[]
  verifyOutputPattern?: RegExp
  verifyOutputExcludePattern?: RegExp
}

type CommandResult = {
  exitCode: number
  output: string
}

export type VsCodeInstallProgressEvent = {
  stage: 'checking' | 'verifying' | 'installing' | 'ready' | 'error'
  message: string
  progress?: number
}

export type EnsureVsCodeInstalledOptions = {
  onProgress?: (event: VsCodeInstallProgressEvent) => void | Promise<void>
}

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000
const MAX_FAILURE_SNIPPET = 240
const VSCODE_DARWIN_DIRECT_URL =
  'https://update.code.visualstudio.com/latest/darwin-universal/stable'

let verificationPromise: Promise<void> | null = null

const DARWIN_VSCODE_APP_PATHS = [
  '/Applications/Visual Studio Code.app',
  join(homedir(), 'Applications', 'Visual Studio Code.app'),
]

function isVsCodeAppInstalledOnDarwin(): boolean {
  return DARWIN_VSCODE_APP_PATHS.some((appPath) => existsSync(appPath))
}

function isVsCodeInstalled(): boolean {
  if (Bun.which('code')) return true
  if (process.platform === 'darwin') {
    return isVsCodeAppInstalledOnDarwin()
  }
  return false
}

function hasCommand(name: string): boolean {
  return Bun.which(name) !== null
}

function getDarwinDirectInstallVsCodeCommand(): string[] {
  return [
    '/bin/bash',
    '-lc',
    `
set -euo pipefail
APP_DIR="$HOME/Applications"
APP_PATH="$APP_DIR/Visual Studio Code.app"
mkdir -p "$APP_DIR"

if [ -d "$APP_PATH" ] || [ -d "/Applications/Visual Studio Code.app" ]; then
  exit 0
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

ZIP_PATH="$TMP_DIR/vscode.zip"
EXTRACT_DIR="$TMP_DIR/extract"
mkdir -p "$EXTRACT_DIR"

curl -fL "${VSCODE_DARWIN_DIRECT_URL}" -o "$ZIP_PATH"
ditto -x -k "$ZIP_PATH" "$EXTRACT_DIR"

EXTRACTED_APP="$EXTRACT_DIR/Visual Studio Code.app"
if [ ! -d "$EXTRACTED_APP" ]; then
  echo "VS Code app bundle missing from downloaded archive."
  exit 1
fi

rm -rf "$APP_PATH"
mv "$EXTRACTED_APP" "$APP_PATH"
`,
  ]
}

function getDarwinDirectVerifyVsCodeCommand(): string[] {
  return [
    '/bin/bash',
    '-lc',
    `
set -euo pipefail
[ -d "$HOME/Applications/Visual Studio Code.app" ] || [ -d "/Applications/Visual Studio Code.app" ]
`,
  ]
}

function getInstallStrategies(): InstallStrategy[] {
  switch (process.platform) {
    case 'darwin':
      return [
        {
          name: 'darwin-direct',
          command: getDarwinDirectInstallVsCodeCommand(),
          verifyCommand: getDarwinDirectVerifyVsCodeCommand(),
        },
      ]
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
            verifyCommand: [
              'winget',
              'list',
              '--id',
              'Microsoft.VisualStudioCode',
            ],
            verifyOutputPattern:
              /microsoft\.visualstudiocode|visual studio code/i,
            verifyOutputExcludePattern: /no installed package found/i,
          },
        ]
      }
      if (hasCommand('choco')) {
        return [
          {
            name: 'choco',
            command: ['choco', 'install', 'vscode', '-y'],
            verifyCommand: [
              'choco',
              'list',
              '--local-only',
              '--exact',
              'vscode',
            ],
            verifyOutputPattern: /\bvscode\s+\d/i,
            verifyOutputExcludePattern: /0 packages installed/i,
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
          verifyCommand: ['dpkg', '-s', 'code'],
        })
      }
      if (hasCommand('snap')) {
        strategies.push({
          name: 'snap',
          command: ['sudo', '-n', 'snap', 'install', 'code', '--classic'],
          verifyCommand: ['snap', 'list', 'code'],
        })
      }
      if (hasCommand('dnf')) {
        strategies.push({
          name: 'dnf',
          command: ['sudo', '-n', 'dnf', 'install', '-y', 'code'],
          verifyCommand: ['dnf', 'list', 'installed', 'code'],
        })
      }
      if (hasCommand('pacman')) {
        strategies.push({
          name: 'pacman',
          command: ['sudo', '-n', 'pacman', '-S', '--noconfirm', 'code'],
          verifyCommand: ['pacman', '-Q', 'code'],
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

async function verifyInstallStrategy(
  strategy: InstallStrategy,
): Promise<boolean> {
  if (!strategy.verifyCommand?.length) return false
  const verify = await runCommand(strategy.verifyCommand)
  if (verify.exitCode !== 0) return false

  if (strategy.verifyOutputExcludePattern?.test(verify.output)) {
    return false
  }
  if (strategy.verifyOutputPattern) {
    return strategy.verifyOutputPattern.test(verify.output)
  }

  return true
}

async function emitProgress(
  options: EnsureVsCodeInstalledOptions | undefined,
  event: VsCodeInstallProgressEvent,
): Promise<void> {
  if (!options?.onProgress) return
  await options.onProgress(event)
}

async function ensureVsCodeInstalledInner(
  options?: EnsureVsCodeInstalledOptions,
): Promise<void> {
  await emitProgress(options, {
    stage: 'checking',
    message: 'Checking whether VS Code is already installed',
    progress: 5,
  })

  if (isVsCodeInstalled()) {
    await emitProgress(options, {
      stage: 'ready',
      message: 'VS Code is already installed',
      progress: 100,
    })
    return
  }

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

  for (const strategy of strategies) {
    await emitProgress(options, {
      stage: 'verifying',
      message: `Verifying installation via ${strategy.name}`,
      progress: 15,
    })
    if (await verifyInstallStrategy(strategy)) {
      logger.info('VS Code already present.', {
        strategy: strategy.name,
      })
      await emitProgress(options, {
        stage: 'ready',
        message: `VS Code already installed (${strategy.name})`,
        progress: 100,
      })
      return
    }
  }

  const failures: string[] = []
  const strategyCount = Math.max(strategies.length, 1)
  const installStep = 60 / strategyCount
  for (const [index, strategy] of strategies.entries()) {
    await emitProgress(options, {
      stage: 'installing',
      message: `Installing VS Code via ${strategy.name}`,
      progress: Math.min(90, Math.round(25 + index * installStep)),
    })
    const result = await runCommand(strategy.command)
    if (result.exitCode === 0) {
      if (isVsCodeInstalled()) {
        logger.info('VS Code installed successfully.', {
          strategy: strategy.name,
        })
        await emitProgress(options, {
          stage: 'ready',
          message: `VS Code installed successfully (${strategy.name})`,
          progress: 100,
        })
        return
      }

      if (await verifyInstallStrategy(strategy)) {
        logger.info('VS Code installed successfully.', {
          strategy: strategy.name,
        })
        await emitProgress(options, {
          stage: 'ready',
          message: `VS Code installed successfully (${strategy.name})`,
          progress: 100,
        })
        return
      }
    }

    const snippet = result.output.slice(0, MAX_FAILURE_SNIPPET)
    failures.push(
      `${strategy.name} failed (exit ${result.exitCode})${snippet ? `: ${snippet}` : ''}`,
    )
  }

  await emitProgress(options, {
    stage: 'error',
    message: 'VS Code installation failed',
    progress: 100,
  })

  throw new Error(
    `VS Code is required for coding mode and automatic installation failed. ${failures.join(' | ')}`,
  )
}

export async function ensureVsCodeInstalledForCoding(
  options?: EnsureVsCodeInstalledOptions,
): Promise<void> {
  if (isVsCodeInstalled()) return
  if (verificationPromise) return verificationPromise

  verificationPromise = ensureVsCodeInstalledInner(options).finally(() => {
    verificationPromise = null
  })
  return verificationPromise
}
