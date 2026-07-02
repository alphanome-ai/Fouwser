/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * LLM config resolution - handles built-in provider lookup.
 */

import { LLM_PROVIDERS, type LLMConfig } from '@browseros/shared/schemas/llm'
import type { ResolvedLLMConfig } from './types'

function isBuiltInProvider(provider: string): boolean {
  return provider === LLM_PROVIDERS.FOUWSER
}

export async function resolveLLMConfig(
  config: LLMConfig,
  _browserosId?: string,
): Promise<ResolvedLLMConfig> {
  if (!isBuiltInProvider(config.provider)) {
    if (!config.model) {
      throw new Error(`Model is required for ${config.provider} provider`)
    }
    return config as ResolvedLLMConfig
  }

  const { authToken, publicApiBaseUrl } = config as LLMConfig & {
    authToken?: string
    publicApiBaseUrl?: string
  }

  if (!authToken) {
    throw new Error('Fouwser provider requires authToken')
  }

  return {
    ...config,
    provider: LLM_PROVIDERS.FOUWSER,
    model: config.model ?? 'default',
    authToken,
    publicApiBaseUrl,
  }
}
