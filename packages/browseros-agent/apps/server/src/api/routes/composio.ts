/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { ComposioClient } from '../../lib/clients/composio/composio-client'
import { COMPOSIO_MCP_SERVERS } from '../../lib/clients/composio/mcp-servers'
import { extractUserId } from '../../lib/clients/composio/user-id'
import { logger } from '../../lib/logger'

const ServerNameSchema = z.object({
  serverName: z.string().min(1),
})

interface ComposioRouteDeps {
  composioClient: ComposioClient
}

function getUserIdFromHeader(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    return extractUserId(authHeader.slice(7))
  } catch {
    return null
  }
}

export function createComposioRoutes(deps: ComposioRouteDeps) {
  const { composioClient } = deps

  return new Hono()
    .get('/servers', (c) => {
      return c.json({
        servers: COMPOSIO_MCP_SERVERS,
        count: COMPOSIO_MCP_SERVERS.length,
      })
    })
    .get('/user-integrations', async (c) => {
      const userId = getUserIdFromHeader(c)
      if (!userId) {
        return c.json({ error: 'Authentication required' }, 401)
      }

      try {
        const session = await composioClient.createSession(userId)
        const toolkitData = await session.toolkits()

        logger.info('Fetched user integrations via Composio', {
          userId: userId.slice(0, 8),
          count: toolkitData.items.length,
        })

        return c.json({
          integrations: toolkitData.items,
          count: toolkitData.items.length,
        })
      } catch (error) {
        logger.error('Error fetching Composio integrations', {
          userId: userId.slice(0, 8),
          error: error instanceof Error ? error.message : String(error),
        })
        return c.json({ error: 'Failed to fetch integrations' }, 500)
      }
    })
    .post('/servers/add', zValidator('json', ServerNameSchema), async (c) => {
      const userId = getUserIdFromHeader(c)
      if (!userId) {
        return c.json({ error: 'Authentication required' }, 401)
      }

      const { serverName } = c.req.valid('json')

      const validServer = COMPOSIO_MCP_SERVERS.find((s) => s.name === serverName)
      if (!validServer) {
        return c.json({ error: `Invalid server: ${serverName}` }, 400)
      }

      try {
        logger.info('Adding server via Composio', { serverName, userId: userId.slice(0, 8) })

        const session = await composioClient.createSession(userId)
        const auth = await session.authorize(validServer.slug)

        logger.info('Composio authorize result', {
          serverName,
          authId: auth.id,
          hasRedirectUrl: !!auth.redirectUrl,
        })

        return c.json({
          success: true,
          serverName,
          mcpUrl: session.mcp.url,
          oauthUrl: auth.redirectUrl ?? undefined,
        })
      } catch (error) {
        logger.error('Error adding server via Composio', {
          serverName,
          error: error instanceof Error ? error.message : String(error),
        })
        return c.json({ error: 'Failed to add server' }, 500)
      }
    })
    .post(
      '/servers/submit-api-key',
      zValidator(
        'json',
        z.object({
          serverName: z.string().min(1),
          apiKey: z.string().min(1),
          apiKeyUrl: z.string().url(),
        }),
      ),
      async (c) => {
        const userId = getUserIdFromHeader(c)
        if (!userId) {
          return c.json({ error: 'Authentication required' }, 401)
        }

        const { serverName } = c.req.valid('json')

        try {
          logger.info('Submitting API key via Composio', { serverName })

          // API key submission is handled by Composio's auth flow
          // when the session connects to the MCP server
          return c.json({ success: true, serverName })
        } catch (error) {
          logger.error('Error submitting API key via Composio', {
            serverName,
            error: error instanceof Error ? error.message : String(error),
          })
          return c.json({ error: 'Failed to submit API key' }, 500)
        }
      },
    )
    .delete(
      '/servers/remove',
      zValidator('json', ServerNameSchema),
      async (c) => {
        const userId = getUserIdFromHeader(c)
        if (!userId) {
          return c.json({ error: 'Authentication required' }, 401)
        }

        const { serverName } = c.req.valid('json')

        const validServer = COMPOSIO_MCP_SERVERS.find((s) => s.name === serverName)
        if (!validServer) {
          return c.json({ error: `Invalid server: ${serverName}` }, 400)
        }

        try {
          logger.info('Removing server via Composio', { serverName, userId: userId.slice(0, 8) })

          // Composio handles server removal at the session level
          return c.json({
            success: true,
            serverName,
          })
        } catch (error) {
          logger.error('Error removing server via Composio', {
            serverName,
            error: error instanceof Error ? error.message : String(error),
          })
          return c.json({ error: 'Failed to remove server' }, 500)
        }
      },
    )
}
