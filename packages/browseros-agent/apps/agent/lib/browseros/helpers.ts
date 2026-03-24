import { env } from '@/lib/env'
import { getBrowserOSAdapter } from './adapter'
import { Capabilities, Feature } from './capabilities'
import { BROWSEROS_PREFS } from './prefs'

export class AgentPortError extends Error {
  constructor() {
    super('Agent server port not configured.')
    this.name = 'AgentPortError'
  }
}

export class ServerDiscoveryError extends Error {
  constructor() {
    super('Could not find the fouwser server on any local port.')
    this.name = 'ServerDiscoveryError'
  }
}

export class McpPortError extends Error {
  constructor() {
    super('MCP server port not configured.')
    this.name = 'McpPortError'
  }
}

const DEFAULT_PORT_SCAN_START = 9200
const DEFAULT_PORT_SCAN_ATTEMPTS = 50
const PORT_SCAN_TIMEOUT_MS = 150

function logResolvedAgentServerUrl(url: string, source: string): void {
  // biome-ignore lint/suspicious/noConsole: intentional startup visibility for resolved local server URL
  console.info(
    `[fouwser-agent] Agent server URL resolved via ${source}: ${url}`,
  )
}

async function findActiveServerPort(
  startPort = DEFAULT_PORT_SCAN_START,
  maxAttempts = DEFAULT_PORT_SCAN_ATTEMPTS,
): Promise<number> {
  for (
    let currentPort = startPort;
    currentPort < startPort + maxAttempts;
    currentPort++
  ) {
    const url = `http://127.0.0.1:${currentPort}/health`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PORT_SCAN_TIMEOUT_MS)

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (response.ok) {
        return currentPort
      }
    } catch {
      // Ignore timeout/connection failures and continue scanning.
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw new ServerDiscoveryError()
}

/**
 * @public
 */
export async function getAgentServerUrl(): Promise<string> {
  // if (env.VITE_BROWSEROS_SERVER_PORT) {
  //   const url = `http://127.0.0.1:${env.VITE_BROWSEROS_SERVER_PORT}`
  //   logResolvedAgentServerUrl(url, 'env')
  //   return url
  // }

  try {
    const port = await findActiveServerPort()
    const url = `http://127.0.0.1:${port}`
    logResolvedAgentServerUrl(url, 'port-scan')
    return url
  } catch {
    const url = await getAgentServerUrlLegacy()
    logResolvedAgentServerUrl(url, 'legacy-fallback')
    return url
  }
}

async function getAgentServerUrlLegacy(): Promise<string> {
  const supportsUnifiedPort = await Capabilities.supports(
    Feature.UNIFIED_PORT_SUPPORT,
  )

  if (supportsUnifiedPort) {
    const port = await getMcpPort()
    return `http://127.0.0.1:${port}`
  }

  const port = await getAgentPort()
  return `http://127.0.0.1:${port}`
}

async function getAgentPort(): Promise<number> {
  if (env.VITE_BROWSEROS_SERVER_PORT) {
    return env.VITE_BROWSEROS_SERVER_PORT
  }

  try {
    const adapter = getBrowserOSAdapter()
    const pref = await adapter.getPref(BROWSEROS_PREFS.AGENT_PORT)

    if (pref?.value && typeof pref.value === 'number') {
      return pref.value
    }
  } catch {
    // BrowserOS API not available
  }

  throw new AgentPortError()
}

async function getMcpPort(): Promise<number> {
  try {
    const adapter = getBrowserOSAdapter()
    const pref = await adapter.getPref(BROWSEROS_PREFS.MCP_PORT)

    if (pref?.value && typeof pref.value === 'number') {
      return pref.value
    }
  } catch {
    // BrowserOS API not available
  }

  throw new McpPortError()
}

/**
 * @public
 */
export async function getMcpServerUrl(): Promise<string> {
  const supportsProxy = await Capabilities.supports(Feature.PROXY_SUPPORT)
  if (supportsProxy) {
    const port = await getProxyPort()
    return `http://127.0.0.1:${port}/mcp`
  }
  const port = await getMcpPort()
  return `http://127.0.0.1:${port}/mcp`
}

export class ProxyPortError extends Error {
  constructor() {
    super('Proxy server port not configured.')
    this.name = 'ProxyPortError'
  }
}

async function getProxyPort(): Promise<number> {
  try {
    const adapter = getBrowserOSAdapter()
    const pref = await adapter.getPref(BROWSEROS_PREFS.PROXY_PORT)

    if (pref?.value && typeof pref.value === 'number') {
      return pref.value
    }
  } catch {
    // BrowserOS API not available
  }

  throw new ProxyPortError()
}

/**
 * @public
 */
export async function getProxyServerUrl(): Promise<string> {
  const port = await getProxyPort()
  return `http://127.0.0.1:${port}`
}

/**
 * @public
 */
export async function getHealthCheckUrl(): Promise<string> {
  const supportsProxy = await Capabilities.supports(Feature.PROXY_SUPPORT)
  if (supportsProxy) {
    const port = await getProxyPort()
    return `http://127.0.0.1:${port}/health`
  }
  const port = await getMcpPort()
  return `http://127.0.0.1:${port}/health`
}
