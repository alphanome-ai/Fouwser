/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { jsonSchemaObjectToZodRawShape } from 'zod-from-json-schema'
import type { ComposioClient } from '../../../lib/clients/composio/composio-client'
import { logger } from '../../../lib/logger'
import { metrics } from '../../../lib/metrics'

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`Composio ${label} timed out`)),
      TIMEOUTS.COMPOSIO_FETCH,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId))
}

export interface ComposioProxyHandle {
  tools: Tool[]
  inputSchemas: Map<string, Record<string, never>>
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<CallToolResult>
  close: () => Promise<void>
}

interface ConnectDeps {
  composioClient: ComposioClient
  userId: string
}

export async function connectComposioProxy(
  deps: ConnectDeps,
): Promise<ComposioProxyHandle> {
  const session = await deps.composioClient.createSession(deps.userId)

  const client = new Client({
    name: 'browseros-composio-proxy',
    version: '1.0.0',
  })

  const transport = new StreamableHTTPClientTransport(new URL(session.mcp.url), {
    requestInit: {
      headers: session.mcp.headers,
    },
  })

  await withTimeout(client.connect(transport), 'connect')

  const { tools } = await withTimeout(client.listTools(), 'listTools')

  const inputSchemas = new Map(
    tools.map((t) => [
      t.name,
      jsonSchemaObjectToZodRawShape(
        t.inputSchema as never,
      ) as unknown as Record<string, never>,
    ]),
  )

  logger.info('Composio proxy connected', {
    toolCount: tools.length,
    userId: deps.userId.slice(0, 8),
  })

  return {
    tools,
    inputSchemas,
    callTool: (name, args) =>
      client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
    close: () => client.close(),
  }
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
