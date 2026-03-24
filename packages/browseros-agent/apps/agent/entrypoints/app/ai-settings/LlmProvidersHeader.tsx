import { Plus } from 'lucide-react'
import type { FC } from 'react'
import ProductLogoSvg from '@/assets/product_logo.svg'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'

interface LlmProvidersHeaderProps {
  providers: LlmProviderConfig[]
  defaultProviderId: string
  onDefaultProviderChange: (providerId: string) => void
  onAddProvider: () => void
}

/**
 * Header section for LLM providers with default provider selector and add button
 */
export const LlmProvidersHeader: FC<LlmProvidersHeaderProps> = ({
  providers,
  defaultProviderId,
  onDefaultProviderChange,
  onAddProvider,
}) => {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md sm:p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <img src={ProductLogoSvg} alt="Fouwser" className="h-8 w-8" />
        </div>
        <div className="flex-1">
          <h2 className="mb-1 font-semibold text-xl">LLM Providers</h2>
          <p className="mb-4 text-muted-foreground text-sm sm:mb-6">
            Add your provider and choose the default LLM
          </p>

          <div className="grid w-full gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
            <label htmlFor="provider-picker" className="font-medium text-sm">
              Default Provider:
            </label>
            <Select
              value={defaultProviderId}
              onValueChange={onDefaultProviderChange}
            >
              <SelectTrigger id="provider-picker" className="w-full min-w-0">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={onAddProvider}
              className="w-full border-[var(--accent-orange)] bg-primary/10 text-[var(--accent-orange)] hover:bg-primary/20 hover:text-[var(--accent-orange)] md:w-auto"
            >
              <Plus className="h-4 w-4" />
              Add custom provider
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
