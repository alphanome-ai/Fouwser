import { basename, extname, resolve } from 'node:path'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { AGENT_LIMITS } from '@browseros/shared/constants/limits'
import type { BrowserContext } from '@browseros/shared/schemas/browser-context'
import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  ToolLoopAgent,
  type UIMessage,
  wrapLanguageModel,
} from 'ai'
import type { Browser } from '../browser/browser'
import { getSkillsDir } from '../lib/browseros-dir'
import type { KlavisClient } from '../lib/clients/klavis/klavis-client'
import { logger } from '../lib/logger'
import { ensureVsCodeInstalledForCoding } from '../lib/prerequisites/vscode'
import { openVsCodeWebUiForFolder } from '../lib/prerequisites/vscode-web'
import { isSoulBootstrap, readSoul } from '../lib/soul'
import { buildSkillsCatalog } from '../skills/catalog'
import { loadSkills } from '../skills/loader'
import { buildFilesystemToolSet } from '../tools/filesystem/build-toolset'
import { buildMemoryToolSet } from '../tools/memory/build-toolset'
import type { ToolRegistry } from '../tools/tool-registry'
import { CHAT_MODE_ALLOWED_TOOLS } from './chat-mode'
import { createCompactionPrepareStep, type StepWithUsage } from './compaction'
import { createContextOverflowMiddleware } from './context-overflow-middleware'
import { buildMcpServerSpecs, createMcpClients } from './mcp-builder'
import {
  getMessageNormalizationOptions,
  normalizeMessagesForModel,
} from './message-normalization'
import { buildSystemPrompt } from './prompt'
import { createLanguageModel } from './provider-factory'
import { buildBrowserToolSet } from './tool-adapter'
import type { ResolvedAgentConfig } from './types'

export interface AiSdkAgentConfig {
  resolvedConfig: ResolvedAgentConfig
  browser: Browser
  registry: ToolRegistry
  browserContext?: BrowserContext
  klavisClient?: KlavisClient
  browserosId?: string
}

type ToolWithExecute = {
  execute?: (...args: unknown[]) => Promise<unknown> | unknown
}

function wrapToolExecuteBefore<T extends ToolWithExecute>(
  toolDef: T,
  beforeExecute: (...args: unknown[]) => Promise<void>,
): T {
  if (typeof toolDef.execute !== 'function') return toolDef
  const originalExecute = toolDef.execute
  return {
    ...toolDef,
    execute: async (...args: unknown[]) => {
      await beforeExecute(...args)
      return originalExecute(...args)
    },
  }
}

const CODE_FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.scala',
  '.sh',
  '.zsh',
  '.sql',
  '.html',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',
])

const CODE_FILE_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'bunfig.toml',
  'go.mod',
  'cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'dockerfile',
  'makefile',
  '.gitignore',
  '.env',
  '.env.example',
])

function shouldOpenVsCodeWebForMutation(resolvedPath: string): boolean {
  const normalized = resolvedPath.replace(/\\/g, '/').toLowerCase()
  const isFouwserPath =
    normalized.includes('/.fouwser/') ||
    normalized.endsWith('/.fouwser') ||
    normalized.startsWith('/.fouwser')
  if (
    normalized.includes('/sessions/') ||
    normalized.includes('/memory/') ||
    normalized.includes('/skills/') ||
    isFouwserPath
  ) {
    return false
  }

  const fileName = basename(normalized)
  const fileExt = extname(fileName)

  if (CODE_FILE_NAMES.has(fileName)) return true
  return CODE_FILE_EXTENSIONS.has(fileExt)
}

function getMutationPathArg(arg: unknown): string | null {
  if (!arg || typeof arg !== 'object') return null
  if (!('path' in arg)) return null
  const maybePath = (arg as { path?: unknown }).path
  return typeof maybePath === 'string' ? maybePath : null
}

export class AiSdkAgent {
  private constructor(
    private _agent: ToolLoopAgent,
    private _messages: UIMessage[],
    private _mcpClients: Array<{ close(): Promise<void> }>,
    private conversationId: string,
  ) {}

  static async create(config: AiSdkAgentConfig): Promise<AiSdkAgent> {
    const contextWindow =
      config.resolvedConfig.contextWindowSize ??
      AGENT_LIMITS.DEFAULT_CONTEXT_WINDOW
    const isCodingMode = config.resolvedConfig.codingMode === true

    // Build language model with overflow protection middleware
    const rawModel = createLanguageModel(config.resolvedConfig)
    const isV3Model =
      typeof rawModel === 'object' &&
      rawModel !== null &&
      'specificationVersion' in rawModel &&
      rawModel.specificationVersion === 'v3'
    const model = isV3Model
      ? wrapLanguageModel({
          model: rawModel as LanguageModelV3,
          middleware: createContextOverflowMiddleware(contextWindow),
        })
      : rawModel

    // Build browser tools from the unified tool registry
    const allBrowserTools = buildBrowserToolSet(
      config.registry,
      config.browser,
      config.resolvedConfig.workingDir,
    )
    const browserTools = config.resolvedConfig.chatMode
      ? Object.fromEntries(
          Object.entries(allBrowserTools).filter(([name]) =>
            CHAT_MODE_ALLOWED_TOOLS.has(name),
          ),
        )
      : allBrowserTools
    if (config.resolvedConfig.chatMode) {
      logger.info('Chat mode enabled, restricting to read-only browser tools', {
        allowedTools: Array.from(CHAT_MODE_ALLOWED_TOOLS),
      })
    }

    // Build external MCP server specs (Klavis, custom) and connect clients
    const specs = await buildMcpServerSpecs({
      browserContext: config.browserContext,
      klavisClient: config.klavisClient,
      browserosId: config.browserosId,
    })
    const { clients, tools: externalMcpTools } = await createMcpClients(specs)

    let hasOpenedVsCodeWeb = false
    let openingVsCodeWebPromise: Promise<void> | null = null
    const maybeOpenVsCodeWeb = async (): Promise<void> => {
      if (!isCodingMode || hasOpenedVsCodeWeb) return
      if (openingVsCodeWebPromise) {
        await openingVsCodeWebPromise
        return
      }

      openingVsCodeWebPromise = (async () => {
        try {
          await ensureVsCodeInstalledForCoding()
          const webUiUrl = await openVsCodeWebUiForFolder(
            config.browser,
            config.resolvedConfig.workingDir,
          )
          hasOpenedVsCodeWeb = true
          logger.info('Opened VS Code Web for coding workspace', {
            conversationId: config.resolvedConfig.conversationId,
            folderPath: config.resolvedConfig.workingDir,
            webUiUrl,
          })
        } catch (error) {
          logger.warn('Failed to open VS Code Web for coding workspace', {
            conversationId: config.resolvedConfig.conversationId,
            folderPath: config.resolvedConfig.workingDir,
            error: error instanceof Error ? error.message : String(error),
          })
        } finally {
          openingVsCodeWebPromise = null
        }
      })()
      await openingVsCodeWebPromise
    }

    if (isCodingMode && !config.resolvedConfig.chatMode) {
      await maybeOpenVsCodeWeb()
    }

    // Add filesystem tools (Pi coding agent) — skip in chat mode (read-only)
    const filesystemTools = config.resolvedConfig.chatMode
      ? {}
      : buildFilesystemToolSet(config.resolvedConfig.workingDir)
    if (isCodingMode && !config.resolvedConfig.chatMode) {
      const writeTool = filesystemTools.filesystem_write as ToolWithExecute
      if (writeTool) {
        filesystemTools.filesystem_write = wrapToolExecuteBefore(
          writeTool,
          async (...args: unknown[]) => {
            const mutationPath = getMutationPathArg(args[0])
            if (!mutationPath) return
            const resolvedPath = resolve(
              config.resolvedConfig.workingDir,
              mutationPath,
            )
            if (!shouldOpenVsCodeWebForMutation(resolvedPath)) return
            await maybeOpenVsCodeWeb()
          },
        ) as typeof filesystemTools.filesystem_write
      }

      const editTool = filesystemTools.filesystem_edit as ToolWithExecute
      if (editTool) {
        filesystemTools.filesystem_edit = wrapToolExecuteBefore(
          editTool,
          async (...args: unknown[]) => {
            const mutationPath = getMutationPathArg(args[0])
            if (!mutationPath) return
            const resolvedPath = resolve(
              config.resolvedConfig.workingDir,
              mutationPath,
            )
            if (!shouldOpenVsCodeWebForMutation(resolvedPath)) return
            await maybeOpenVsCodeWeb()
          },
        ) as typeof filesystemTools.filesystem_edit
      }
    }
    const memoryTools = config.resolvedConfig.chatMode
      ? {}
      : buildMemoryToolSet()
    const tools = {
      ...browserTools,
      ...externalMcpTools,
      ...filesystemTools,
      ...memoryTools,
    }

    if (
      config.resolvedConfig.isScheduledTask ||
      config.resolvedConfig.chatMode
    ) {
      delete tools.suggest_schedule
      delete tools.suggest_app_connection
    }

    // Build system prompt with optional section exclusions
    const excludeSections: string[] = []
    if (config.resolvedConfig.isScheduledTask) {
      excludeSections.push('tab-grouping')
    }
    if (
      config.resolvedConfig.isScheduledTask ||
      config.resolvedConfig.chatMode
    ) {
      excludeSections.push('nudges')
    }
    const soulContent = await readSoul()
    const isBootstrap = await isSoulBootstrap()

    // Load skills catalog for prompt injection
    const skills = await loadSkills(getSkillsDir())
    const skillsCatalog =
      skills.length > 0 ? buildSkillsCatalog(skills) : undefined

    const instructions = buildSystemPrompt({
      userSystemPrompt: config.resolvedConfig.userSystemPrompt,
      exclude: excludeSections,
      isScheduledTask: config.resolvedConfig.isScheduledTask,
      scheduledTaskWindowId: config.browserContext?.windowId,
      workspaceDir: config.resolvedConfig.workingDir,
      soulContent,
      isSoulBootstrap: isBootstrap,
      chatMode: config.resolvedConfig.chatMode,
      connectedApps: config.browserContext?.enabledMcpServers,
      declinedApps: config.resolvedConfig.declinedApps,
      skillsCatalog,
      codingMode: config.resolvedConfig.codingMode,
    })

    // Configure compaction for context window management
    const compactionPrepareStep = createCompactionPrepareStep({
      contextWindow,
    })
    const normalizationOptions = getMessageNormalizationOptions(
      config.resolvedConfig,
    )
    const prepareStep = async (options: {
      messages: ModelMessage[]
      steps: ReadonlyArray<StepWithUsage>
      model: LanguageModel
      experimental_context: unknown
    }) =>
      compactionPrepareStep({
        ...options,
        messages: normalizeMessagesForModel(
          options.messages,
          normalizationOptions,
        ),
      })

    // Create the ToolLoopAgent
    const agent = new ToolLoopAgent({
      model,
      instructions,
      tools,
      stopWhen: [stepCountIs(AGENT_LIMITS.MAX_TURNS)],
      prepareStep,
    })

    logger.info('Agent session created (v2)', {
      conversationId: config.resolvedConfig.conversationId,
      provider: config.resolvedConfig.provider,
      model: config.resolvedConfig.model,
      toolCount: Object.keys(tools).length,
    })

    return new AiSdkAgent(
      agent,
      [],
      clients,
      config.resolvedConfig.conversationId,
    )
  }

  get toolLoopAgent(): ToolLoopAgent {
    return this._agent
  }

  get messages(): UIMessage[] {
    return this._messages
  }

  set messages(msgs: UIMessage[]) {
    this._messages = msgs
  }

  appendUserMessage(content: string): void {
    this._messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: content }],
    })
  }

  async dispose(): Promise<void> {
    for (const client of this._mcpClients) {
      await client.close().catch(() => {})
    }
    logger.info('Agent disposed', { conversationId: this.conversationId })
  }
}
