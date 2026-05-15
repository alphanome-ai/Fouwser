import useSWRMutation from 'swr/mutation'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'
import { useSessionInfo } from '@/lib/auth/sessionStorage'

interface AddServerResponse {
  success: boolean
  serverName: string
  mcpUrl?: string
}

interface AddServerError {
  error: string
}

const addManagedServer = (
  authToken: string,
) => async (
  url: string,
  { arg }: { arg: { serverName: string } },
): Promise<AddServerResponse> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ serverName: arg.serverName }),
  })

  if (!response.ok) {
    const errorData = (await response.json()) as AddServerError
    throw new Error(errorData.error || 'Failed to add server')
  }

  return response.json() as Promise<AddServerResponse>
}

export const useAddManagedServer = () => {
  const { baseUrl: agentServerUrl } = useAgentServerUrl()
  const { sessionInfo } = useSessionInfo()
  const authToken = sessionInfo?.session?.accessToken

  return useSWRMutation(
    agentServerUrl && authToken ? `${agentServerUrl}/composio/servers/add` : null,
    addManagedServer(authToken ?? ''),
  )
}
