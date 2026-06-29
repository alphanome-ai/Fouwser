import useSWRMutation from 'swr/mutation'
import { authorizedFetch } from '@/lib/auth/auth-client'
import { useSessionInfo } from '@/lib/auth/sessionStorage'
import { readIntegrationError } from './integrationsClient'
import { resolveIntegrationSlug } from './managedServerCatalog'

interface SubmitApiKeyResponse {
  success: boolean
  serverName: string
}

const submitApiKey = async (
  _key: string,
  { arg }: { arg: { serverName: string; apiKey: string; apiKeyUrl: string } },
): Promise<SubmitApiKeyResponse> => {
  const slug = resolveIntegrationSlug(arg.serverName)
  const response = await authorizedFetch(
    `/api/v1/integrations/${slug}/api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: arg.apiKey,
        apiKeyUrl: arg.apiKeyUrl,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(
      await readIntegrationError(response, 'Failed to submit API key'),
    )
  }

  const data = (await response.json()) as { success: boolean }
  return { success: data.success, serverName: arg.serverName }
}

export const useSubmitApiKey = () => {
  const { sessionInfo } = useSessionInfo()
  const authToken = sessionInfo?.session?.accessToken

  return useSWRMutation(authToken ? 'integrations/api-key' : null, submitApiKey)
}
