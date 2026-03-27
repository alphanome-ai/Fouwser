type RequiredCliTool = {
  name: string
  installHint: string
}

const REQUIRED_CLI_TOOLS: RequiredCliTool[] = [
  { name: 'bun', installHint: 'https://bun.sh/docs/installation' },
  { name: 'git', installHint: 'https://git-scm.com/downloads' },
  { name: 'vercel', installHint: 'https://vercel.com/docs/cli' },
]

const REQUIRED_CLI_TOOL_NAMES = new Set(
  REQUIRED_CLI_TOOLS.map((tool) => tool.name),
)

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)
}

function extractExecutable(segment: string): string | null {
  const tokens = segment.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]

    if (token === 'sudo') {
      i += 1
      while (i < tokens.length && tokens[i].startsWith('-')) i += 1
      continue
    }

    if (token === 'env') {
      i += 1
      while (i < tokens.length && isEnvAssignment(tokens[i])) i += 1
      continue
    }

    if (token === 'command' || token === 'time') {
      i += 1
      continue
    }

    if (isEnvAssignment(token)) {
      i += 1
      continue
    }

    return token
  }

  return null
}

export function extractRequiredCliToolsForCommand(command: string): string[] {
  const required = new Set<string>()
  const segments = command
    .split(/&&|\|\||;|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  for (const segment of segments) {
    const executable = extractExecutable(segment)
    if (!executable) continue
    if (REQUIRED_CLI_TOOL_NAMES.has(executable)) required.add(executable)
  }

  return Array.from(required)
}

function getMissingCliTools(tools: string[]): RequiredCliTool[] {
  const required = new Set(tools)
  return REQUIRED_CLI_TOOLS.filter(
    (tool) => required.has(tool.name) && Bun.which(tool.name) === null,
  )
}

export function ensureCliToolsForCommand(command: string): void {
  const requiredTools = extractRequiredCliToolsForCommand(command)
  if (requiredTools.length === 0) return

  const missing = getMissingCliTools(requiredTools)
  if (missing.length === 0) return

  const missingText = missing
    .map((tool) => `${tool.name} (${tool.installHint})`)
    .join(', ')

  throw new Error(
    `Required CLI tools are missing for this coding command. Missing: ${missingText}`,
  )
}
