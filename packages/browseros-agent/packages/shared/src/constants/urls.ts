/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Centralized external service URLs.
 */

function getEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return undefined
}

export const EXTERNAL_URLS = {
  // Prefer explicit env config, fall back to Klavis cloud API.
  KLAVIS_PROXY:
    getEnv('KLAVIS_PROXY_URL', 'KLAVIS_PROXY') || 'https://api.klavis.ai/v1',
  POSTHOG_DEFAULT: getEnv('POSTHOG_HOST', 'POSTHOG_DEFAULT') || '',
  CODEGEN_SERVICE: getEnv('CODEGEN_SERVICE_URL', 'CODEGEN_SERVICE') || '',
} as const
