import useSWR from 'swr'
import { authorizedFetch } from '@/lib/auth/auth-client'
import { useSessionInfo } from '@/lib/auth/sessionStorage'

interface UserMCPIntegrationsList {
  integrations: {
    slug: string
    name: string
    is_authenticated: boolean
  }[]
  count: number
}

const getUserMCPIntegrations = async () => {
  const response = await authorizedFetch('/api/v1/integrations')
  const data = (await response.json()) as UserMCPIntegrationsList
  return data
}

export const useGetUserMCPIntegrations = () => {
  const { sessionInfo } = useSessionInfo()
  const authToken = sessionInfo?.session?.accessToken

  return useSWR(
    authToken ? 'integrations/user' : null,
    getUserMCPIntegrations,
    {
      keepPreviousData: true,
      revalidateOnFocus: true,
    },
  )
}
