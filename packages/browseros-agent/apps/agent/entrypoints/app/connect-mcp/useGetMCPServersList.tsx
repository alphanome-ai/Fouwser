import useSWR from 'swr'
import { env } from '@/lib/env'

interface McpServerResponse {
  servers: {
    name: string
    slug: string
    description: string
  }[]
  count: number
}

const getApiBaseUrl = (): string => {
  const baseUrl = env.VITE_PUBLIC_BROWSEROS_API?.trim()
  if (!baseUrl) {
    throw new Error('VITE_PUBLIC_BROWSEROS_API is required')
  }
  return baseUrl.replace(/\/$/, '')
}

const getAllManagedServers = async () => {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/integrations/catalog`)
  const servers = (await response.json()) as McpServerResponse
  return servers
}

export const useGetMCPServersList = () => {
  return useSWR('integrations/catalog', getAllManagedServers, {
    keepPreviousData: true,
  })
}
