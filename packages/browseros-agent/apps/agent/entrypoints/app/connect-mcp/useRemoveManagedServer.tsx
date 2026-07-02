import useSWRMutation from 'swr/mutation'
import { authorizedFetch } from '@/lib/auth/auth-client'
import { useSessionInfo } from '@/lib/auth/sessionStorage'
import { readIntegrationError } from './integrationsClient'
import { resolveIntegrationSlug } from './managedServerCatalog'

interface RemoveServerResponse {
  success: boolean
  serverName: string
}

const removeManagedServer = async (
  _key: string,
  { arg }: { arg: { serverName: string } },
): Promise<RemoveServerResponse> => {
  const slug = resolveIntegrationSlug(arg.serverName)
  const response = await authorizedFetch(`/api/v1/integrations/${slug}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(
      await readIntegrationError(response, 'Failed to remove server'),
    )
  }

  const data = (await response.json()) as { success: boolean }
  return { success: data.success, serverName: arg.serverName }
}

export const useRemoveManagedServer = () => {
  const { sessionInfo } = useSessionInfo()
  const authToken = sessionInfo?.session?.accessToken

  return useSWRMutation(
    authToken ? 'integrations/disconnect' : null,
    removeManagedServer,
  )
}
