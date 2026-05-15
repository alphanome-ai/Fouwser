import useSWRMutation from 'swr/mutation'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'
import { useSessionInfo } from '@/lib/auth/sessionStorage'

interface RemoveServerResponse {
  success: boolean
  serverName: string
}

interface RemoveServerError {
  error: string
}

const removeManagedServer = (
  authToken: string,
) => async (
  url: string,
  { arg }: { arg: { serverName: string } },
): Promise<RemoveServerResponse> => {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ serverName: arg.serverName }),
  })

  if (!response.ok) {
    const errorData = (await response.json()) as RemoveServerError
    throw new Error(errorData.error || 'Failed to remove server')
  }

  return response.json() as Promise<RemoveServerResponse>
}

export const useRemoveManagedServer = () => {
  const { baseUrl: agentServerUrl } = useAgentServerUrl()
  const { sessionInfo } = useSessionInfo()
  const authToken = sessionInfo?.session?.accessToken

  return useSWRMutation(
    agentServerUrl && authToken ? `${agentServerUrl}/composio/servers/remove` : null,
    removeManagedServer(authToken ?? ''),
  )
}
