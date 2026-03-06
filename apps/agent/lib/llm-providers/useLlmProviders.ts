import { useEffect, useMemo, useState } from 'react'
import {
  createDefaultProvidersConfig,
  DEFAULT_PROVIDER_FALLBACK_ID,
  DEFAULT_PROVIDER_ID,
  defaultProviderIdStorage,
  ENABLE_DEFAULT_FREE_PROVIDER,
  loadProviders,
  providersStorage,
} from './storage'
import type { LlmProviderConfig } from './types'

function sanitizeProviders(list: LlmProviderConfig[]): LlmProviderConfig[] {
  if (ENABLE_DEFAULT_FREE_PROVIDER) return list
  return list.filter((provider) => {
    const providerType = String(provider.type).toLowerCase()
    return (
      provider.id !== DEFAULT_PROVIDER_ID &&
      provider.id !== 'browseros' &&
      providerType !== 'fouwser' &&
      providerType !== 'browseros' &&
      !(
        provider.baseUrl === 'https://api.fouwser.com/v1' &&
        provider.modelId === 'fouwser-auto'
      )
    )
  })
}

/**
 * Hook return type
 * @public
 */
export interface UseLlmProvidersReturn {
  /** All configured providers */
  providers: LlmProviderConfig[]
  /** ID of the default provider */
  defaultProviderId: string
  /** Full config of the currently selected provider */
  selectedProvider: LlmProviderConfig | null
  /** Whether data is loading */
  isLoading: boolean
  /** Save or update a provider */
  saveProvider: (provider: LlmProviderConfig) => Promise<void>
  /** Set the default provider */
  setDefaultProvider: (providerId: string) => Promise<void>
  /** Delete a provider */
  deleteProvider: (providerId: string) => Promise<void>
}

/**
 * Hook for managing LLM provider configurations
 * @public
 */
export function useLlmProviders(): UseLlmProvidersReturn {
  const [providers, setProviders] = useState<LlmProviderConfig[]>([])
  const [defaultProviderId, setDefaultProviderId] = useState<string>(
    DEFAULT_PROVIDER_FALLBACK_ID,
  )
  const [isLoading, setIsLoading] = useState(true)

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      try {
        let [loadedProviders, loadedDefaultId] = await Promise.all([
          loadProviders(),
          defaultProviderIdStorage.getValue(),
        ])

        // When the built-in free provider is disabled, remove any persisted copy
        // from older installs so it disappears from selectors.
        if (loadedProviders?.length) {
          const filteredProviders = sanitizeProviders(loadedProviders)
          if (filteredProviders.length !== loadedProviders.length) {
            loadedProviders = filteredProviders
            await providersStorage.setValue(filteredProviders)
          }
        }

        // Initialize with defaults if storage is empty
        if (!loadedProviders || loadedProviders.length === 0) {
          loadedProviders = createDefaultProvidersConfig()
          await providersStorage.setValue(loadedProviders)
        }

        const hasSelectedDefault =
          !!loadedDefaultId &&
          loadedProviders.some((provider) => provider.id === loadedDefaultId)
        if (!hasSelectedDefault) {
          loadedDefaultId =
            loadedProviders[0]?.id || DEFAULT_PROVIDER_FALLBACK_ID
          await defaultProviderIdStorage.setValue(loadedDefaultId)
        }

        setProviders(loadedProviders)
        setDefaultProviderId(loadedDefaultId)
      } catch {
        // TODO: Record error to error recording service
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  // Listen for storage changes
  useEffect(() => {
    const unsubscribeProviders = providersStorage.watch((newProviders) => {
      if (newProviders) {
        setProviders(sanitizeProviders(newProviders))
      }
    })

    const unsubscribeDefaultId = defaultProviderIdStorage.watch(
      (newDefaultId) => {
        if (typeof newDefaultId === 'string') {
          setDefaultProviderId(newDefaultId)
        }
      },
    )

    return () => {
      unsubscribeProviders()
      unsubscribeDefaultId()
    }
  }, [])

  const saveProvider = async (provider: LlmProviderConfig) => {
    const currentProviders = (await providersStorage.getValue()) || []
    const existingIndex = currentProviders.findIndex(
      (p) => p.id === provider.id,
    )

    let updatedProviders: LlmProviderConfig[]
    if (existingIndex >= 0) {
      // Update existing provider
      updatedProviders = [...currentProviders]
      updatedProviders[existingIndex] = {
        ...provider,
        updatedAt: Date.now(),
      }
    } else {
      // Add new provider
      updatedProviders = [
        ...currentProviders,
        {
          ...provider,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
    }

    await providersStorage.setValue(updatedProviders)
  }

  const setDefaultProviderFn = async (providerId: string) => {
    setDefaultProviderId(providerId)
    await defaultProviderIdStorage.setValue(providerId)
  }

  const deleteProvider = async (providerId: string) => {
    // Prevent deletion of built-in BrowserOS provider
    if (ENABLE_DEFAULT_FREE_PROVIDER && providerId === DEFAULT_PROVIDER_ID) {
      return
    }

    const currentProviders = (await providersStorage.getValue()) || []
    const updatedProviders = currentProviders.filter((p) => p.id !== providerId)

    // Handle default provider reassignment if deleted provider was default
    if (defaultProviderId === providerId) {
      const newDefaultId =
        updatedProviders[0]?.id || DEFAULT_PROVIDER_FALLBACK_ID
      await defaultProviderIdStorage.setValue(newDefaultId)
    }

    await providersStorage.setValue(updatedProviders)
  }

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === defaultProviderId) ?? null,
    [providers, defaultProviderId],
  )

  return {
    providers,
    defaultProviderId,
    selectedProvider,
    isLoading,
    saveProvider,
    setDefaultProvider: setDefaultProviderFn,
    deleteProvider,
  }
}
