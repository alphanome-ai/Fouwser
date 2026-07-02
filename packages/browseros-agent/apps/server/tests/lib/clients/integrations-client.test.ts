import { afterEach, describe, expect, it } from 'bun:test'
import { IntegrationsClient } from '../../../src/lib/clients/integrations/integrations-client'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('IntegrationsClient', () => {
  it('authenticates MCP proxy sessions with the user bearer token only', async () => {
    const requests: Request[] = []
    globalThis.fetch = (async (input, init) => {
      requests.push(new Request(input, init))
      return Response.json({
        sessionId: 'proxy-session-123',
        mcpUrl:
          'https://api.fouwser.test/api/v1/integrations/mcp/proxy-session-123',
        headers: { 'x-api-key': 'legacy-composio-key' },
      })
    }) as typeof fetch

    const session = await new IntegrationsClient().createMcpSession(
      'user-access-token',
      'https://api.fouwser.test/',
    )

    expect(requests).toHaveLength(1)
    expect(requests[0].headers.get('authorization')).toBe(
      'Bearer user-access-token',
    )
    expect(session).toEqual({
      sessionId: 'proxy-session-123',
      mcp: {
        url: 'https://api.fouwser.test/api/v1/integrations/mcp/proxy-session-123',
        headers: { Authorization: 'Bearer user-access-token' },
      },
    })
  })
})
