import type { FC } from 'react'
import { Badge } from '@/components/ui/badge'
import { ProviderIcon } from '@/lib/llm-providers/providerIcons'
import type { ProviderTemplate } from '@/lib/llm-providers/providerTemplates'
import { cn } from '@/lib/utils'

interface ProviderTemplateCardProps {
  template: ProviderTemplate
  highlighted?: boolean
  onUseTemplate: (template: ProviderTemplate) => void
}

export const ProviderTemplateCard: FC<ProviderTemplateCardProps> = ({
  template,
  highlighted = false,
  onUseTemplate,
}) => {
  return (
    <button
      type="button"
      onClick={() => onUseTemplate(template)}
      className={cn(
        'group flex w-full min-w-0 items-center gap-3 rounded-lg border p-4 text-left transition-all hover:border-[var(--accent-orange)] hover:shadow-md',
        highlighted
          ? 'border-[var(--accent-orange)]/50 bg-primary/5 shadow-sm'
          : 'border-border bg-background',
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 transition-colors group-hover:text-accent-orange',
          highlighted ? 'text-accent-orange' : 'text-accent-orange/70',
        )}
      >
        <ProviderIcon type={template.id} size={28} />
        <span className="truncate font-medium text-foreground">
          {template.name}
        </span>
      </div>
      <Badge
        variant="outline"
        className={cn(
          'shrink-0 rounded-md px-3 py-1 transition-colors group-hover:border-[var(--accent-orange)] group-hover:text-[var(--accent-orange)]',
          highlighted &&
            'border-[var(--accent-orange)]/50 bg-primary/10 text-[var(--accent-orange)]',
        )}
      >
        USE
      </Badge>
    </button>
  )
}
