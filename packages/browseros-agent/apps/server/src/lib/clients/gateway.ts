/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { logger } from '../logger'

const CONFIG_CACHE_TTL_MINUTES = 1000 * 60 * 5

export interface Provider {
  name: string
  model: string
  apiKey: string
  baseUrl?: string
  dailyRateLimit?: number
  providerType?: string // LLMProvider value from ai-gateway: "openrouter" | "azure" | "anthropic"
}

export interface BrowserOSConfig {
  providers: Provider[]
}

export interface LLMConfig {
  modelName: string
  baseUrl?: string
  apiKey: string
  provider: Provider
  providerType?: string
}

interface CachedBrowserOSConfig {
  config: BrowserOSConfig
  expiresAt: number
}

const browserosConfigCache = new Map<string, CachedBrowserOSConfig>()
const browserosConfigInFlight = new Map<string, Promise<BrowserOSConfig>>()

function getBrowserOSConfigCacheKey(
  configUrl: string,
  browserosId?: string,
  authToken?: string,
): string {
  return JSON.stringify([configUrl, browserosId ?? '', authToken ?? ''])
}

export async function fetchBrowserOSConfig(
  configUrl: string,
  browserosId?: string,
  authToken?: string,
): Promise<BrowserOSConfig> {
  const cacheKey = getBrowserOSConfigCacheKey(configUrl, browserosId, authToken)
  const cachedConfig = browserosConfigCache.get(cacheKey)
  if (cachedConfig && Date.now() < cachedConfig.expiresAt) {
    logger.debug('Using cached Fouwser config', { configUrl, browserosId })
    return cachedConfig.config
  }

  const inFlightRequest = browserosConfigInFlight.get(cacheKey)
  if (inFlightRequest) {
    logger.debug('Awaiting in-flight Fouwser config request', {
      configUrl,
      browserosId,
    })
    return inFlightRequest
  }

  logger.debug('Fetching Fouwser config', { configUrl, browserosId })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (browserosId) {
    headers['X-Fouwser-ID'] = browserosId
  }

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const request = (async () => {
    try {
      const response = await fetch(configUrl, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Failed to fetch config: ${response.status} ${response.statusText} - ${errorText}`,
        )
      }

      const config = (await response.json()) as BrowserOSConfig

      if (!Array.isArray(config.providers) || config.providers.length === 0) {
        throw new Error(
          'Invalid config response: providers array is empty or missing',
        )
      }

      for (const provider of config.providers) {
        if (!provider.name || !provider.model || !provider.apiKey) {
          throw new Error('Invalid provider: missing name, model, or apiKey')
        }
      }

      browserosConfigCache.set(cacheKey, {
        config,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MINUTES,
      })

      const defaultProvider = config.providers.find((p) => p.name === 'default')
      logger.info('✅ Fouwser config fetched', {
        providerCount: config.providers.length,
        dailyRateLimit: defaultProvider?.dailyRateLimit,
      })

      return config
    } catch (error) {
      logger.error('❌ Failed to fetch Fouwser config', {
        configUrl,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })()

  browserosConfigInFlight.set(cacheKey, request)

  try {
    return await request
  } finally {
    if (browserosConfigInFlight.get(cacheKey) === request) {
      browserosConfigInFlight.delete(cacheKey)
    }
  }
}

export function clearBrowserOSConfigCache(): void {
  browserosConfigCache.clear()
  browserosConfigInFlight.clear()
}

/**
 * Get LLM config from a provider in the BrowserOS config
 * @param config - BrowserOS config containing providers
 * @param providerName - Name of the provider to use (defaults to 'default')
 * @returns LLM config with modelName, baseUrl, apiKey, and provider
 */
export function getLLMConfigFromProvider(
  config: BrowserOSConfig,
  providerName = 'default',
): LLMConfig {
  const provider = config.providers.find((p) => p.name === providerName)

  if (!provider) {
    throw new Error(
      `Provider '${providerName}' not found in config. Available providers: ${config.providers.map((p) => p.name).join(', ')}`,
    )
  }

  return {
    modelName: provider.model,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    provider,
    providerType: provider.providerType,
  }
}
