/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, it, mock } from 'bun:test'
import assert from 'node:assert'
import { createComposioRoutes } from '../../../src/api/routes/composio'

function createTestJwt(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'user' })).toString('base64url')
  return `${header}.${payload}.fake-sig`
}

function createMockComposioClient() {
  return {
    createSession: mock(() =>
      Promise.resolve({
        mcp: {
          type: 'streamable-http',
          url: 'https://mcp.example.com/session/123',
          headers: { Authorization: 'Bearer composio-token' },
        },
      }),
    ),
  } as any
}

describe('createComposioRoutes', () => {
  it('returns the server catalog', async () => {
    const route = createComposioRoutes({
      composioClient: createMockComposioClient(),
    })
    const response = await route.request('/servers')
    const body = await response.json()

    assert.strictEqual(response.status, 200)
    assert.ok(Array.isArray(body.servers))
    assert.ok(body.count > 0)
    assert.ok(body.servers.some((s: any) => s.name === 'Gmail'))
  })

  it('returns 401 for user-integrations without auth', async () => {
    const route = createComposioRoutes({
      composioClient: createMockComposioClient(),
    })
    const response = await route.request('/user-integrations')

    assert.strictEqual(response.status, 401)
  })

  it('returns user integrations with valid auth', async () => {
    const client = createMockComposioClient()
    const route = createComposioRoutes({ composioClient: client })
    const token = createTestJwt('user-uuid-123')

    const response = await route.request('/user-integrations', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const body = await response.json()

    assert.strictEqual(response.status, 200)
    assert.ok(Array.isArray(body.integrations))
    assert.strictEqual(typeof body.count, 'number')
  })

  it('returns 401 for servers/add without auth', async () => {
    const route = createComposioRoutes({
      composioClient: createMockComposioClient(),
    })
    const response = await route.request('/servers/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName: 'Gmail' }),
    })

    assert.strictEqual(response.status, 401)
  })

  it('adds a server with valid auth', async () => {
    const client = createMockComposioClient()
    const route = createComposioRoutes({ composioClient: client })
    const token = createTestJwt('user-uuid-123')

    const response = await route.request('/servers/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ serverName: 'Gmail' }),
    })
    const body = await response.json()

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.serverName, 'Gmail')
    assert.ok(body.mcpUrl)
  })

  it('rejects invalid server names', async () => {
    const route = createComposioRoutes({
      composioClient: createMockComposioClient(),
    })
    const token = createTestJwt('user-uuid-123')

    const response = await route.request('/servers/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ serverName: 'NonExistentService' }),
    })

    assert.strictEqual(response.status, 400)
  })

  it('returns 401 for servers/remove without auth', async () => {
    const route = createComposioRoutes({
      composioClient: createMockComposioClient(),
    })
    const response = await route.request('/servers/remove', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName: 'Gmail' }),
    })

    assert.strictEqual(response.status, 401)
  })

  it('removes a server with valid auth', async () => {
    const route = createComposioRoutes({
      composioClient: createMockComposioClient(),
    })
    const token = createTestJwt('user-uuid-123')

    const response = await route.request('/servers/remove', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ serverName: 'Gmail' }),
    })
    const body = await response.json()

    assert.strictEqual(response.status, 200)
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.serverName, 'Gmail')
  })
})
