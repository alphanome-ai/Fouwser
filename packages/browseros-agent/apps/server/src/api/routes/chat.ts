import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import { zValidator } from '@hono/zod-validator'
import { createParser, type EventSourceMessage } from 'eventsource-parser'
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { SessionStore } from '../../agent/session-store'
import type { Browser } from '../../browser/browser'
import { KlavisClient } from '../../lib/clients/klavis/klavis-client'
import { logger } from '../../lib/logger'
import { metrics } from '../../lib/metrics'
import { ensureVsCodeInstalledForCoding } from '../../lib/prerequisites/vscode'
import type { RateLimiter } from '../../lib/rate-limiter/rate-limiter'
import { Sentry } from '../../lib/sentry'
import type { ToolRegistry } from '../../tools/tool-registry'
import { createBrowserosRateLimitMiddleware } from '../middleware/rate-limit'
import { ChatService } from '../services/chat-service'
import { ChatRequestSchema } from '../types'
import {
  formatUIMessageStreamDone,
  formatUIMessageStreamEvent,
} from '../utils/ui-message-stream'
import { ConversationIdParamSchema } from '../utils/validation'

interface ChatRouteDeps {
  browser: Browser
  registry: ToolRegistry
  browserosId?: string
  rateLimiter?: RateLimiter
}

async function forwardUIMessageStream(
  response: Response,
  write: (chunk: string) => Promise<unknown> | unknown,
  options?: { skipStart?: boolean },
): Promise<void> {
  if (!response.body) {
    throw new Error('Chat response body is not readable.')
  }

  const decoder = new TextDecoder()
  const pendingEvents: UIMessageStreamEvent[] = []
  let skippedStart = false

  const parser = createParser({
    onEvent: (msg: EventSourceMessage) => {
      if (msg.data === '[DONE]') return
      try {
        const event = JSON.parse(msg.data) as UIMessageStreamEvent
        pendingEvents.push(event)
      } catch {
        // Ignore malformed stream events.
      }
    },
  })

  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      parser.feed(decoder.decode(value, { stream: true }))

      let next = pendingEvents.shift()
      while (next) {
        if (options?.skipStart && !skippedStart && next.type === 'start') {
          skippedStart = true
        } else {
          await write(formatUIMessageStreamEvent(next))
        }
        next = pendingEvents.shift()
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function createChatRoutes(deps: ChatRouteDeps) {
  const { browserosId, rateLimiter } = deps

  const sessionStore = new SessionStore()
  const klavisClient = new KlavisClient()
  const service = new ChatService({
    sessionStore,
    klavisClient,
    browser: deps.browser,
    registry: deps.registry,
    browserosId,
  })

  return new Hono()
    .post(
      '/',
      zValidator('json', ChatRequestSchema),
      createBrowserosRateLimitMiddleware({ rateLimiter, browserosId }),
      async (c) => {
        const request = c.req.valid('json')

        // Sentry + metrics (HTTP concerns only)
        Sentry.getCurrentScope().setTag(
          'request-type',
          request.isScheduledTask ? 'schedule' : 'chat',
        )
        Sentry.setContext('request', {
          provider: request.provider,
          model: request.model,
          baseUrl: request.baseUrl,
        })

        metrics.log('chat.request', {
          provider: request.provider,
          model: request.model,
        })

        logger.info('Chat request received', {
          conversationId: request.conversationId,
          provider: request.provider,
          model: request.model,
        })

        if (request.mode !== 'coding') {
          return service.processMessage(request, c.req.raw.signal)
        }

        c.header('Content-Type', 'text/event-stream')
        c.header('Cache-Control', 'no-cache')
        c.header('Connection', 'keep-alive')
        c.header('x-vercel-ai-ui-message-stream', 'v1')

        return stream(c, async (honoStream) => {
          const prereqToolCallId = `vscode-prereq-${crypto.randomUUID()}`
          const prereqCommand =
            'curl -fL https://update.code.visualstudio.com/latest/darwin-universal/stable -o vscode.zip && install Visual Studio Code.app'

          const emitPrereqUpdate = async (
            message: string,
            progress?: number,
          ) => {
            await honoStream.write(
              formatUIMessageStreamEvent({
                type: 'tool-input-available',
                toolCallId: prereqToolCallId,
                toolName: 'filesystem_bash_coding',
                input: {
                  command: prereqCommand,
                  message,
                  progress,
                },
              }),
            )
          }

          try {
            await honoStream.write(
              formatUIMessageStreamEvent({
                type: 'start',
              }),
            )

            await ensureVsCodeInstalledForCoding({
              onProgress: async (event) => {
                if (event.stage === 'ready') {
                  await emitPrereqUpdate(event.message, event.progress)
                  await honoStream.write(
                    formatUIMessageStreamEvent({
                      type: 'tool-output-available',
                      toolCallId: prereqToolCallId,
                      output: {
                        type: 'text',
                        value: event.message,
                      },
                    }),
                  )
                  return
                }

                if (event.stage === 'error') {
                  await honoStream.write(
                    formatUIMessageStreamEvent({
                      type: 'tool-output-error',
                      toolCallId: prereqToolCallId,
                      errorText: event.message,
                    }),
                  )
                  return
                }

                await emitPrereqUpdate(event.message, event.progress)
              },
            })

            const agentResponse = await service.processMessage(
              request,
              c.req.raw.signal,
              { skipCodingPrereq: true },
            )
            await forwardUIMessageStream(
              agentResponse,
              (chunk) => honoStream.write(chunk),
              {
                skipStart: true,
              },
            )
          } catch (error) {
            const errorText =
              error instanceof Error ? error.message : String(error)

            await honoStream.write(
              formatUIMessageStreamEvent({
                type: 'tool-output-error',
                toolCallId: prereqToolCallId,
                errorText,
              }),
            )
            await honoStream.write(
              formatUIMessageStreamEvent({
                type: 'error',
                errorText,
              }),
            )
            await honoStream.write(
              formatUIMessageStreamEvent({
                type: 'finish',
                finishReason: 'error',
              }),
            )
          } finally {
            await honoStream.write(formatUIMessageStreamDone())
          }
        })
      },
    )
    .delete(
      '/:conversationId',
      zValidator('param', ConversationIdParamSchema),
      async (c) => {
        const { conversationId } = c.req.valid('param')
        const result = await service.deleteSession(conversationId)

        if (result.deleted) {
          return c.json({
            success: true,
            message: `Session ${conversationId} deleted`,
            sessionCount: result.sessionCount,
          })
        }

        return c.json(
          { success: false, message: `Session ${conversationId} not found` },
          404,
        )
      },
    )
}
