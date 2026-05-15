import useSWR from 'swr'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'
import { useSessionInfo } from '@/lib/auth/sessionStorage'

interface UserMCPIntegrationsList {
  integrations: {
    name: string
    is_authenticated: boolean
  }[]
  count: number
}

const getUserMCPIntegrations = async ([hostUrl, endpoint, authToken]: [string, string, string]) => {
  const response = await fetch(`${hostUrl}/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  })
  const data = (await response.json()) as UserMCPIntegrationsList
  return data
}

export const useGetUserMCPIntegrations = () => {
  const { baseUrl: agentServerUrl } = useAgentServerUrl()
  const { sessionInfo } = useSessionInfo()
  const authToken = sessionInfo?.session?.accessToken

  return useSWR(
    agentServerUrl && authToken ? [agentServerUrl, 'composio/user-integrations', authToken] : null,
    getUserMCPIntegrations,
    {
      keepPreviousData: true,
      revalidateOnFocus: true,
    },
  )
}
