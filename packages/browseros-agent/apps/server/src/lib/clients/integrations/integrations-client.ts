/**
 * Client for the Fouwser backend integrations API (`/api/v1/integrations`).
 *
 * Composio lives entirely in the backend; the app never holds a Composio API
 * key. To load a user's connected tools, the agent asks the backend for a
 * per-user MCP session and connects to the returned Fouwser MCP proxy URL with
 * the user's bearer token. Backend-returned MCP headers are intentionally not
 * forwarded; the backend proxy owns upstream provider credentials.
 */

import { logger } from '../../logger'

export interface IntegrationsMcpSession {
  sessionId: string
  mcp: {
    url: string
    headers: Record<string, string>
  }
}

interface McpSessionResponse {
  sessionId: string
  mcpUrl: string
  headers?: Record<string, string>
}

export class IntegrationsClient {
  /**
   * Fetch a per-user Composio MCP session from the backend.
   *
   * @param authToken  The user's Fouwser access token (JWT).
   * @param apiBaseUrl The backend base URL (e.g. https://api.fouwser.com).
   */
  async createMcpSession(
    authToken: string,
    apiBaseUrl: string,
  ): Promise<IntegrationsMcpSession> {
    const base = apiBaseUrl.replace(/\/$/, '')
    const response = await fetch(`${base}/api/v1/integrations/mcp-session`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `Failed to fetch MCP session (${response.status}): ${text}`,
      )
    }

    const data = (await response.json()) as McpSessionResponse
    logger.info('Fetched integrations MCP session from backend', {
      sessionId: data.sessionId,
    })

    return {
      sessionId: data.sessionId,
      mcp: {
        url: data.mcpUrl,
        headers: { Authorization: `Bearer ${authToken}` },
      },
    }
  }
}
