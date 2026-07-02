import useSWRMutation from 'swr/mutation'
import { authorizedFetch } from '@/lib/auth/auth-client'
import { useSessionInfo } from '@/lib/auth/sessionStorage'
import { readIntegrationError } from './integrationsClient'
import { resolveIntegrationSlug } from './managedServerCatalog'

interface AddServerResponse {
  success: boolean
  serverName: string
  mcpUrl?: string
  oauthUrl?: string
  apiKeyUrl?: string
}

interface BackendConnectResponse {
  success: boolean
  slug: string
  mcpUrl?: string
  oauthUrl?: string
}

const addManagedServer = async (
  _key: string,
  { arg }: { arg: { serverName: string } },
): Promise<AddServerResponse> => {
  const slug = resolveIntegrationSlug(arg.serverName)
  const response = await authorizedFetch(
    `/api/v1/integrations/${slug}/connect`,
    { method: 'POST' },
  )

  if (!response.ok) {
    throw new Error(
      await readIntegrationError(response, 'Failed to add server'),
    )
  }

  const data = (await response.json()) as BackendConnectResponse
  return {
    success: data.success,
    serverName: arg.serverName,
    mcpUrl: data.mcpUrl,
    oauthUrl: data.oauthUrl,
  }
}

export const useAddManagedServer = () => {
  const { sessionInfo } = useSessionInfo()
  const authToken = sessionInfo?.session?.accessToken

  return useSWRMutation(
    authToken ? 'integrations/connect' : null,
    addManagedServer,
  )
}
