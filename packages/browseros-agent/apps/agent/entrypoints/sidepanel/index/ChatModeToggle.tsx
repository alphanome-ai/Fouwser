import { Braces, MessageSquare, MousePointer2 } from 'lucide-react'
import type { FC } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ChatMode } from './chatTypes'

interface ChatModeToggleProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
}

export const ChatModeToggle: FC<ChatModeToggleProps> = ({
  mode,
  onModeChange,
}) => {
  const modeMeta: Record<
    ChatMode,
    {
      label: string
      description: string
      icon: typeof MessageSquare
    }
  > = {
    chat: {
      label: 'Chat',
      description: 'Read-only Q&A about page and context',
      icon: MessageSquare,
    },
    agent: {
      label: 'Agent',
      description: 'Can browse, click, and automate browser tasks',
      icon: MousePointer2,
    },
    coding: {
      label: 'Coding',
      description: 'Uses your local system for coding tasks',
      icon: Braces,
    },
  }

  const tooltip = modeMeta[mode]

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex w-full items-center rounded-full border border-border/60 bg-muted/40 p-0.5">
            {(Object.keys(modeMeta) as ChatMode[]).map((modeKey) => {
              const isActive = modeKey === mode
              const Icon = modeMeta[modeKey].icon

              return (
                <button
                  key={modeKey}
                  type="button"
                  onClick={() => onModeChange(modeKey)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 text-xs transition-all min-[440px]:gap-1.5 min-[440px]:px-2.5',
                    isActive
                      ? 'bg-primary/15 font-semibold text-[var(--accent-orange)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  <span className="hidden min-[380px]:inline">
                    {modeMeta[modeKey].label}
                  </span>
                </button>
              )
            })}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px]">
          {tooltip.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
