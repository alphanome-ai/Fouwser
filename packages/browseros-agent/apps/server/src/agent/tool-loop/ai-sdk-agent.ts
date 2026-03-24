import { AGENT_LIMITS } from '@browseros/shared/constants/limits'
import type { BrowserContext } from '@browseros/shared/schemas/browser-context'
import { stepCountIs, ToolLoopAgent, type UIMessage } from 'ai'
import type { Browser } from '../../browser/browser'
import type { KlavisClient } from '../../lib/clients/klavis/klavis-client'
import { logger } from '../../lib/logger'
import { ensureVsCodeInstalledForCoding } from '../../lib/prerequisites/vscode'
import { openVsCodeWebUiForFolder } from '../../lib/prerequisites/vscode-web'
import { isSoulBootstrap, readSoul } from '../../lib/soul'
import { buildFilesystemToolSet } from '../../tools/filesystem/build-toolset'
import {
  buildCodingMemoryToolSet,
  buildMemoryToolSet,
} from '../../tools/memory/build-toolset'
import type { ToolRegistry } from '../../tools/tool-registry'
import { buildSystemPrompt } from '../prompt'
import type { ResolvedAgentConfig } from '../types'
import { createCompactionPrepareStep } from './compaction'
import { buildMcpServerSpecs, createMcpClients } from './mcp-builder'
import { createLanguageModel } from './provider-factory'
import { buildBrowserToolSet } from './tool-adapter'

export interface AiSdkAgentConfig {
  resolvedConfig: ResolvedAgentConfig
  browser: Browser
  registry: ToolRegistry
  browserContext?: BrowserContext
  klavisClient?: KlavisClient
  browserosId?: string
}

export class AiSdkAgent {
  private constructor(
    private _agent: ToolLoopAgent,
    private _messages: UIMessage[],
    private _mcpClients: Array<{ close(): Promise<void> }>,
    private conversationId: string,
  ) {}

  static async create(config: AiSdkAgentConfig): Promise<AiSdkAgent> {
    const isChatMode = config.resolvedConfig.chatMode === true
    const isCodingMode = config.resolvedConfig.codingMode === true

    // Build language model from provider config
    const model = createLanguageModel(config.resolvedConfig)

    // Build browser tools from the unified tool registry.
    // Coding mode keeps minimal browser tools for local IDE + web preview.
    const browserTools = isCodingMode
      ? buildBrowserToolSet(config.registry, config.browser, {
          allowNames: new Set(['vscode_web', 'new_page']),
        })
      : buildBrowserToolSet(config.registry, config.browser)

    // Build external MCP server specs (Klavis, custom) and connect clients.
    // Skip in coding mode to keep execution focused on local code tasks.
    let clients: Array<{ close(): Promise<void> }> = []
    let externalMcpTools = {}
    if (!isCodingMode) {
      const specs = await buildMcpServerSpecs({
        browserContext: config.browserContext,
        klavisClient: config.klavisClient,
        browserosId: config.browserosId,
      })
      const mcp = await createMcpClients(specs)
      clients = mcp.clients
      externalMcpTools = mcp.tools
    }

    if (isCodingMode && !isChatMode) {
      try {
        await ensureVsCodeInstalledForCoding()
        const webUiUrl = await openVsCodeWebUiForFolder(
          config.browser,
          config.resolvedConfig.sessionExecutionDir,
        )
        logger.info('Opened VS Code Web for coding workspace', {
          conversationId: config.resolvedConfig.conversationId,
          folderPath: config.resolvedConfig.sessionExecutionDir,
          webUiUrl,
        })
      } catch (error) {
        logger.warn('Failed to open VS Code Web for coding workspace', {
          conversationId: config.resolvedConfig.conversationId,
          folderPath: config.resolvedConfig.sessionExecutionDir,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Add filesystem tools (Pi coding agent) — skip in chat mode (read-only)
    const filesystemTools = isChatMode
      ? {}
      : buildFilesystemToolSet(config.resolvedConfig.sessionExecutionDir)
    const memoryTools = isChatMode
      ? {}
      : isCodingMode
        ? buildCodingMemoryToolSet()
        : buildMemoryToolSet()
    const tools = {
      ...browserTools,
      ...externalMcpTools,
      ...filesystemTools,
      ...memoryTools,
    }

    // Build system prompt with optional section exclusions
    // Tool definitions are already injected by the AI SDK via tool schemas,
    // so skip the redundant tool-reference section.
    const excludeSections: string[] = ['tool-reference']
    if (config.resolvedConfig.isScheduledTask) {
      excludeSections.push('tab-grouping')
    }
    if (isCodingMode) {
      excludeSections.push(
        'complete-tasks',
        'auto-included-context',
        'observe-act-verify',
        'handle-obstacles',
        'error-recovery',
        'external-integrations',
      )
    }
    const soulContent = await readSoul()
    const isBootstrap = await isSoulBootstrap()
    const instructions = buildSystemPrompt({
      userSystemPrompt: config.resolvedConfig.userSystemPrompt,
      exclude: excludeSections,
      isScheduledTask: config.resolvedConfig.isScheduledTask,
      scheduledTaskWindowId: config.browserContext?.windowId,
      workspaceDir: config.resolvedConfig.sessionExecutionDir,
      soulContent,
      isSoulBootstrap: isBootstrap,
      chatMode: config.resolvedConfig.chatMode,
      codingMode: config.resolvedConfig.codingMode,
    })

    // Configure compaction for context window management
    const contextWindow =
      config.resolvedConfig.contextWindowSize ??
      AGENT_LIMITS.DEFAULT_CONTEXT_WINDOW
    const prepareStep = createCompactionPrepareStep({
      contextWindow,
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
