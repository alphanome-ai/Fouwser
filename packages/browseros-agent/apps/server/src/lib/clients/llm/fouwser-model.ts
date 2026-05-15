/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Buffer } from 'node:buffer'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider'
import { INLINED_ENV } from '../../../env'
import { logger } from '../../logger'
import { fetchBrowserOSConfig, getLLMConfigFromProvider } from '../gateway'
import type { ResolvedLLMConfig } from './types'

type RequestMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

type RequestTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: unknown
  }
}

type RequestBody = {
  model: string
  messages: RequestMessage[]
  stream: boolean
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  stop?: string | string[]
  tools?: RequestTool[]
  tool_choice?: string | Record<string, unknown>
}

type ResponseUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  input_tokens?: number
  output_tokens?: number
}

type ResponseMessage = {
  content?: string | Array<{ type?: string; text?: string }>
  tool_calls?: Array<{
    id: string
    type?: string
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

type ResponseBody = {
  choices?: Array<{
    message?: ResponseMessage
    finish_reason?: string | null
  }>
  usage?: ResponseUsage
}

function ensureFouwserConfig(
  config: ResolvedLLMConfig,
): asserts config is ResolvedLLMConfig & {
  authToken: string
} {
  if (!config.authToken) {
    throw new Error('Fouwser provider requires authToken')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toTextContent(
  content: string | Array<{ type?: string; text?: string }>,
): string | Array<{ type: 'text'; text: string }> | undefined {
  if (typeof content === 'string') {
    return content
  }

  const textParts = content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => ({ type: 'text' as const, text: part.text as string }))

  return textParts.length > 0 ? textParts : undefined
}

function encodeBinary(value: Uint8Array | ArrayBuffer): string {
  const buffer =
    value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(value)
  return buffer.toString('base64')
}

function toImageUrl(
  image: string | URL | Uint8Array | ArrayBuffer,
  mediaType = 'image/png',
): { type: 'image_url'; image_url: { url: string } } {
  if (typeof image === 'string') {
    return { type: 'image_url', image_url: { url: image } }
  }

  if (image instanceof URL) {
    return { type: 'image_url', image_url: { url: image.toString() } }
  }

  return {
    type: 'image_url',
    image_url: {
      url: `data:${mediaType};base64,${encodeBinary(image)}`,
    },
  }
}

function toUserContentPart(
  part: unknown,
):
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | null {
  if (!isRecord(part) || typeof part.type !== 'string') {
    return null
  }

  if (part.type === 'text' && typeof part.text === 'string') {
    return { type: 'text', text: part.text }
  }

  if (part.type === 'reasoning' && typeof part.text === 'string') {
    return { type: 'text', text: part.text }
  }

  if (part.type === 'image') {
    const image = part.image
    const mediaType =
      typeof part.mediaType === 'string' ? part.mediaType : 'image/png'

    if (typeof image === 'string') {
      return toImageUrl(image, mediaType)
    }

    if (image instanceof URL) {
      return toImageUrl(image, mediaType)
    }

    if (image instanceof Uint8Array || image instanceof ArrayBuffer) {
      return toImageUrl(image, mediaType)
    }
  }

  if (
    part.type === 'file' &&
    typeof part.mediaType === 'string' &&
    part.mediaType.startsWith('image/')
  ) {
    const data = part.data
    if (
      typeof data === 'string' ||
      data instanceof URL ||
      data instanceof Uint8Array ||
      data instanceof ArrayBuffer
    ) {
      return toImageUrl(data, part.mediaType)
    }
  }

  return null
}

function isToolCallPart(part: unknown): part is {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: unknown
} {
  return (
    isRecord(part) &&
    part.type === 'tool-call' &&
    typeof part.toolCallId === 'string' &&
    typeof part.toolName === 'string'
  )
}

function promptToMessages(prompt: LanguageModelV3Prompt): RequestMessage[] {
  const messages: RequestMessage[] = []

  for (const message of prompt) {
    if (typeof message !== 'object' || !message || !('role' in message)) {
      continue
    }

    if (message.role === 'tool') {
      const content = Array.isArray(message.content) ? message.content : []
      for (const part of content) {
        if (part.type !== 'tool-result') continue

        let outputText = ''
        if (
          part.output?.type === 'text' &&
          typeof part.output.value === 'string'
        ) {
          outputText = part.output.value
        } else if (part.output?.type === 'json') {
          outputText = JSON.stringify(part.output.value)
        } else if (part.output?.type === 'content') {
          outputText = JSON.stringify(part.output.value)
        } else if (part.output?.type === 'error-text') {
          outputText = part.output.value
        } else {
          outputText = JSON.stringify(part.output)
        }

        messages.push({
          role: 'tool',
          content: outputText,
          tool_call_id: part.toolCallId,
          name: part.toolName,
        })
      }
      continue
    }

    if (typeof message.content === 'string') {
      messages.push({
        role: message.role,
        content: message.content,
      })
      continue
    }

    const parts = Array.isArray(message.content) ? message.content : []
    const textParts = parts
      .map((part) => toUserContentPart(part))
      .filter(
        (
          part,
        ): part is
          | { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string } } => part !== null,
      )

    const toolCalls = parts.filter(isToolCallPart).map((part) => {
      const inputValue = part.input
      return {
        id: part.toolCallId,
        type: 'function' as const,
        function: {
          name: part.toolName,
          arguments:
            typeof inputValue === 'string'
              ? inputValue
              : JSON.stringify(inputValue ?? {}),
        },
      }
    })

    messages.push({
      role: message.role,
      content: textParts.length > 0 ? textParts : undefined,
      tool_calls:
        message.role === 'assistant' && toolCalls.length > 0
          ? toolCalls
          : undefined,
    })
  }

  return messages
}

function extractTools(
  params: LanguageModelV3CallOptions,
): RequestTool[] | undefined {
  if (!params.tools || params.tools.length === 0) {
    return undefined
  }

  const tools: RequestTool[] = []

  for (const tool of params.tools) {
    if (tool.type !== 'function') {
      continue
    }

    tools.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })
  }

  return tools.length > 0 ? tools : undefined
}

function mapToolChoice(
  toolChoice: LanguageModelV3CallOptions['toolChoice'],
): RequestBody['tool_choice'] {
  if (!toolChoice) {
    return undefined
  }

  switch (toolChoice.type) {
    case 'auto':
    case 'none':
    case 'required':
      return toolChoice.type
    case 'tool':
      return {
        type: 'function',
        function: {
          name: toolChoice.toolName,
        },
      }
    default:
      return undefined
  }
}

function buildRequestBody(
  model: string,
  params: LanguageModelV3CallOptions,
  stream: boolean,
): RequestBody {
  const r: RequestBody = {
    model,
    messages: promptToMessages(params.prompt),
    stream,
    temperature: params.temperature,
    max_tokens: params.maxOutputTokens,
    top_p: params.topP,
    frequency_penalty: params.frequencyPenalty,
    presence_penalty: params.presencePenalty,
    stop: params.stopSequences,
    tools: extractTools(params),
    tool_choice: mapToolChoice(params.toolChoice),
  }
  logger.debug('Chat completion request ', { r })
  return r
}

async function resolveHostedFouwserTarget(
  config: ResolvedLLMConfig,
): Promise<{ baseUrl: string; model: string }> {
  ensureFouwserConfig(config)

  const configUrl = INLINED_ENV.BROWSEROS_CONFIG_URL
  if (!configUrl) {
    throw new Error('Fouwser provider requires BROWSEROS_CONFIG_URL')
  }

  const browserosConfig = await fetchBrowserOSConfig(
    configUrl,
    undefined,
    config.authToken,
  )
  const llmConfig = getLLMConfigFromProvider(browserosConfig, 'default')

  if (!llmConfig.baseUrl) {
    throw new Error('Hosted provider config is missing baseUrl')
  }

  return {
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.modelName,
  }
}

function mapUsage(usage?: ResponseUsage) {
  const inputTotal = usage?.prompt_tokens ?? usage?.input_tokens ?? 0
  const outputTotal = usage?.completion_tokens ?? usage?.output_tokens ?? 0

  return {
    inputTokens: {
      total: inputTotal,
      noCache: inputTotal,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTotal,
      text: outputTotal,
      reasoning: undefined,
    },
  }
}

function mapFinishReason(reason?: string | null): LanguageModelV3FinishReason {
  switch (reason) {
    case 'tool_calls':
      return { unified: 'tool-calls', raw: reason }
    case 'length':
    case 'max_tokens':
      return { unified: 'length', raw: reason }
    case 'content_filter':
      return { unified: 'content-filter', raw: reason }
    case 'error':
      return { unified: 'error', raw: reason }
    case undefined:
    case null:
    case 'stop':
      return { unified: 'stop', raw: reason ?? 'stop' }
    default:
      return { unified: 'other', raw: reason }
  }
}

function responseToGenerateResult(
  response: ResponseBody,
): LanguageModelV3GenerateResult {
  const choice = response.choices?.[0]
  const message = choice?.message
  const content: LanguageModelV3GenerateResult['content'] = []

  const textContent = message?.content
    ? toTextContent(message.content)
    : undefined
  if (typeof textContent === 'string') {
    content.push({ type: 'text', text: textContent })
  } else if (Array.isArray(textContent)) {
    for (const part of textContent) {
      content.push(part)
    }
  }

  for (const call of message?.tool_calls ?? []) {
    if (!call.id || !call.function?.name) continue
    content.push({
      type: 'tool-call',
      toolCallId: call.id,
      toolName: call.function.name,
      input: call.function.arguments ?? '{}',
    })
  }

  return {
    content,
    finishReason: mapFinishReason(choice?.finish_reason),
    usage: mapUsage(response.usage),
    warnings: [],
    response: {
      body: response,
    },
  }
}

function generateResultToStream(
  result: LanguageModelV3GenerateResult,
): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({
        type: 'stream-start',
        warnings: result.warnings,
      })

      let activeTextId: string | null = null

      for (const part of result.content) {
        if (part.type === 'text') {
          if (!activeTextId) {
            activeTextId = crypto.randomUUID()
            controller.enqueue({ type: 'text-start', id: activeTextId })
          }
          controller.enqueue({
            type: 'text-delta',
            id: activeTextId,
            delta: part.text,
          })
          continue
        }

        if (activeTextId) {
          controller.enqueue({ type: 'text-end', id: activeTextId })
          activeTextId = null
        }

        if (part.type === 'tool-call') {
          controller.enqueue({
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          })
        }
      }

      if (activeTextId) {
        controller.enqueue({ type: 'text-end', id: activeTextId })
      }

      controller.enqueue({
        type: 'finish',
        finishReason: result.finishReason,
        usage: result.usage,
      })
      controller.close()
    },
  })
}

async function postChatCompletion(
  config: ResolvedLLMConfig,
  params: LanguageModelV3CallOptions,
): Promise<ResponseBody> {
  ensureFouwserConfig(config)

  const hostedTarget = await resolveHostedFouwserTarget(config)
  const requestBody = buildRequestBody(hostedTarget.model, params, false)
  const response = await fetch(
    `${hostedTarget.baseUrl.replace(/\/$/, '')}/chat/completion`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: params.abortSignal,
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Fouwser chat request failed: ${response.status} ${response.statusText} ` +
        `at ${hostedTarget.baseUrl.replace(/\/$/, '')}/chat/completion ` +
        `with model=${hostedTarget.model} - ${errorText}`,
    )
  }

  return (await response.json()) as ResponseBody
}

export function createFouwserLanguageModel(
  config: ResolvedLLMConfig,
): LanguageModelV3 {
  ensureFouwserConfig(config)

  return {
    specificationVersion: 'v3',
    provider: 'fouwser',
    modelId: config.model ?? 'default',
    supportedUrls: {},
    doGenerate: async (
      params: LanguageModelV3CallOptions,
    ): Promise<LanguageModelV3GenerateResult> => {
      const response = await postChatCompletion(config, params)
      return responseToGenerateResult(response)
    },
    doStream: async (
      params: LanguageModelV3CallOptions,
    ): Promise<LanguageModelV3StreamResult> => {
      const response = await postChatCompletion(config, params)
      const result = responseToGenerateResult(response)
      return {
        stream: generateResultToStream(result),
        response: {
          headers: {},
        },
      }
    },
  }
}
