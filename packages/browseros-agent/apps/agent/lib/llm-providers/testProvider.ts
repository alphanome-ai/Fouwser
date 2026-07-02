import { getSession } from '@/lib/auth/auth-client'
import { env } from '@/lib/env'
import type { LlmProviderConfig } from './types'

/**
 * @public
 */
export interface TestResult {
  success: boolean
  message: string
  responseTime?: number
}

/**
 * Test a provider connection via the agent server's /test-provider endpoint.
 * This uses the same code path as actual chat requests, ensuring accurate validation.
 * @public
 */
export async function testProvider(
  provider: LlmProviderConfig,
  agentServerUrl: string,
): Promise<TestResult> {
  const startTime = performance.now()
  const sessionInfo =
    provider.type === 'fouwser'
      ? await getSession({ forceRefresh: true })
      : null

  try {
    const response = await fetch(`${agentServerUrl}/test-provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: provider.type,
        model: provider.modelId,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        // Azure
        resourceName: provider.resourceName,
        // Bedrock
        region: provider.region,
        accessKeyId: provider.accessKeyId,
        secretAccessKey: provider.secretAccessKey,
        sessionToken: provider.sessionToken,
        authToken:
          provider.type === 'fouwser'
            ? sessionInfo?.session?.accessToken
            : undefined,
        publicApiBaseUrl:
          provider.type === 'fouwser'
            ? env.VITE_PUBLIC_BROWSEROS_API
            : undefined,
      }),
    })

    const result = (await response.json()) as TestResult

    if (!result.responseTime) {
      result.responseTime = Math.round(performance.now() - startTime)
    }

    return result
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime)

    if (error instanceof Error) {
      return {
        success: false,
        message: error.message,
        responseTime,
      }
    }

    return {
      success: false,
      message: 'An unexpected error occurred',
      responseTime,
    }
  }
}
