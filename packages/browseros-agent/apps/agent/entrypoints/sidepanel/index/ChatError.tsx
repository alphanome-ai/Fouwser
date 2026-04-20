import { AlertCircle, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'

interface ChatErrorProps {
  error: Error
  onRetry?: () => void
}

interface ParsedErrorPayload {
  error?: {
    message?: string
    code?: string
    statusCode?: number
  }
}

function parseEmbeddedErrorPayload(message: string): ParsedErrorPayload | null {
  const candidateMessages = [message]
  const embeddedErrorIndex = message.indexOf('{"error":')
  if (embeddedErrorIndex >= 0) {
    candidateMessages.push(message.slice(embeddedErrorIndex))
  }

  const genericJsonIndex = message.indexOf('{')
  if (
    genericJsonIndex >= 0 &&
    genericJsonIndex !== embeddedErrorIndex
  ) {
    candidateMessages.push(message.slice(genericJsonIndex))
  }

  for (const candidate of candidateMessages) {
    try {
      return JSON.parse(candidate) as ParsedErrorPayload
    } catch {}
  }

  return null
}

function parseErrorMessage(message: string): {
  text: string
  url?: string
  isRateLimit?: boolean
  isConnectionError?: boolean
} {
  // Detect MCP server connection failures
  if (
    (message.includes('Failed to fetch') || message.includes('fetch failed')) &&
    message.includes('127.0.0.1')
  ) {
    return {
      text: 'Unable to connect to Fouwser agent. Follow below instructions.',
      url: 'https://docs.browseros.com/troubleshooting/connection-issues',
      isConnectionError: true,
    }
  }

  const parsedPayload = parseEmbeddedErrorPayload(message)
  const parsedMessage = parsedPayload?.error?.message
  const parsedCode = parsedPayload?.error?.code
  const parsedStatusCode = parsedPayload?.error?.statusCode

  // Detect Fouwser-hosted usage limit responses from both local and hosted paths.
  if (
    message.includes('Fouwser LLM daily limit reached') ||
    parsedCode === 'RATE_LIMIT_EXCEEDED' ||
    parsedStatusCode === 429 ||
    parsedMessage?.includes('User rate limit exceeded') ||
    message.includes('429 Too Many Requests')
  ) {
    return {
      text: 'You have reached the current Fouwser usage limit. Try again after your daily quota window resets, or switch to your own API key in AI settings.',
      isRateLimit: true,
    }
  }

  let text = parsedMessage ?? message

  // Extract URL if present
  const urlMatch = text.match(/https?:\/\/[^\s]+/)
  const url = urlMatch?.[0]
  if (url) {
    text = text.replace(url, '').replace(/\s+/g, ' ').trim()
  }

  return { text: text || 'An unexpected error occurred', url }
}

export const ChatError: FC<ChatErrorProps> = ({ error, onRetry }) => {
  const { text, url, isRateLimit, isConnectionError } = parseErrorMessage(
    error.message,
  )

  const aiSettingsUrl = useMemo(
    () => new URL('/app.html#/settings/ai', window.location.origin).toString(),
    [],
  )

  const getTitle = () => {
    if (isRateLimit) return 'Usage limit reached'
    if (isConnectionError) return 'Connection failed'
    return 'Something went wrong'
  }

  return (
    <div className="mx-4 flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <AlertCircle className="h-5 w-5" />
        <span className="font-medium text-sm">{getTitle()}</span>
      </div>
      <p className="text-center text-destructive text-xs">{text}</p>
      {isConnectionError && url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground text-xs underline hover:text-foreground"
        >
          View troubleshooting guide
        </a>
      )}
      {isRateLimit && (
        <p className="text-muted-foreground text-xs">
          <a
            href={aiSettingsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Open AI settings
          </a>
          {/* {' or '}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Learn more
          </a> */}
        </p>
      )}
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-1 gap-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      )}
    </div>
  )
}
