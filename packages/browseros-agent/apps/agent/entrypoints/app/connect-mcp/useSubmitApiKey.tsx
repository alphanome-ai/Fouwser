import useSWRMutation from 'swr/mutation'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'
import { useSessionInfo } from '@/lib/auth/sessionStorage'

interface SubmitApiKeyResponse {
  success: boolean
  serverName: string
}

interface SubmitApiKeyError {
  error: string
}

const submitApiKey = (
  authToken: string,
) => async (
  url: string,
  { arg }: { arg: { serverName: string; apiKey: string; apiKeyUrl: string } },
): Promise<SubmitApiKeyResponse> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      serverName: arg.serverName,
      apiKey: arg.apiKey,
      apiKeyUrl: arg.apiKeyUrl,
    }),
  })

  if (!response.ok) {
    const errorData = (await response.json()) as SubmitApiKeyError
    throw new Error(errorData.error || 'Failed to submit API key')
  }

  return response.json() as Promise<SubmitApiKeyResponse>
}

export const useSubmitApiKey = () => {
  const { baseUrl: agentServerUrl } = useAgentServerUrl()
  const { sessionInfo } = useSessionInfo()
  const authToken = sessionInfo?.session?.accessToken

  return useSWRMutation(
    agentServerUrl && authToken ? `${agentServerUrl}/composio/servers/submit-api-key` : null,
    submitApiKey(authToken ?? ''),
  )
}
