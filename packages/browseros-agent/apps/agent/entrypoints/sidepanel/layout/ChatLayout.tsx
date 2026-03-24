import type { FC } from 'react'
import { Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { ChatHeader } from '../index/ChatHeader'
import {
  ChatSessionProvider,
  useChatSessionContext,
} from './ChatSessionContext'

const ChatLayoutContent: FC = () => {
  const {
    providers,
    selectedProvider,
    handleSelectProvider,
    resetConversation,
    messages,
    isLoading,
  } = useChatSessionContext()

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    )
  }

  if (!selectedProvider || providers.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center">
          <h2 className="font-semibold text-base text-foreground">
            No LLM provider configured
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            Set up a provider in Agent settings to start using chat.
          </p>
          <Button
            className="mt-4 w-full"
            onClick={() => {
              window.open(
                '/app.html#/settings/ai',
                '_blank',
                'noopener,noreferrer',
              )
            }}
          >
            Set up LLM provider
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <ChatHeader
        selectedProvider={selectedProvider}
        onSelectProvider={handleSelectProvider}
        providers={providers}
        onNewConversation={resetConversation}
        hasMessages={messages.length > 0}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}

export const ChatLayout: FC = () => {
  return (
    <ChatSessionProvider>
      <ChatLayoutContent />
    </ChatSessionProvider>
  )
}
