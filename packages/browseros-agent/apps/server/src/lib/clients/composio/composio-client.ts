/**
 * Wraps the @composio/core SDK for managing external service integrations.
 */

import { Composio } from '@composio/core'
import { logger } from '../../logger'

export interface ComposioToolkit {
  slug: string
  name: string
  is_authenticated: boolean
}

export interface ComposioSession {
  sessionId: string
  mcp: {
    type: string
    url: string
    headers: Record<string, string>
  }
  authorize: (
    toolkit: string,
    options?: { callbackUrl?: string },
  ) => Promise<{ id: string; redirectUrl?: string | null }>
  toolkits: () => Promise<{ items: ComposioToolkit[] }>
}

export class ComposioClient {
  private composio: Composio | null = null

  private getClient(): Composio {
    if (!this.composio) {
      this.composio = new Composio()
    }
    return this.composio
  }

  async createSession(userId: string): Promise<ComposioSession> {
    logger.info('Creating Composio session', {
      userId: userId.slice(0, 8),
    })

    const session = await this.getClient().create(userId)

    return {
      sessionId: session.sessionId,
      mcp: {
        type: session.mcp.type,
        url: session.mcp.url,
        headers: session.mcp.headers ?? {},
      },
      authorize: (toolkit, options) => session.authorize(toolkit, options),
      toolkits: async () => {
        const result = await session.toolkits()
        return {
          items: result.items.map((t) => ({
            slug: t.slug,
            name: t.name,
            is_authenticated: t.connection?.isActive ?? false,
          })),
        }
      },
    }
  }
}
