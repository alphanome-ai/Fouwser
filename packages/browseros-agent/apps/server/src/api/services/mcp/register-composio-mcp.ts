/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { logger } from '../../../lib/logger'
import { metrics } from '../../../lib/metrics'

export interface ComposioProxyHandle {
  tools: Tool[]
  inputSchemas: Map<string, Record<string, never>>
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<CallToolResult>
  close: () => Promise<void>
}

export function registerComposioTools(
  mcpServer: McpServer,
  handle: ComposioProxyHandle,
): void {
  for (const tool of handle.tools) {
    const inputSchema = handle.inputSchemas.get(tool.name)

    mcpServer.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema,
      },
      async (args: Record<string, unknown>) => {
        const startTime = performance.now()
        try {
          const result = await handle.callTool(tool.name, args)

          metrics.log('tool_executed', {
            tool_name: tool.name,
            source: 'composio',
            duration_ms: Math.round(performance.now() - startTime),
            success: !result.isError,
          })

          return result
        } catch (error) {
          const errorText =
            error instanceof Error ? error.message : String(error)

          metrics.log('tool_executed', {
            tool_name: tool.name,
            source: 'composio',
            duration_ms: Math.round(performance.now() - startTime),
            success: false,
            error_message: errorText,
          })

          return {
            content: [{ type: 'text' as const, text: errorText }],
            isError: true,
          }
        }
      },
    )
  }

  logger.debug('Registered Composio tools on MCP server', {
    count: handle.tools.length,
  })
}
