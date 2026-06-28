/**
 * Proxy Service Module - Chat Completions Route
 * Implements /v1/chat/completions route
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { PassThrough } from 'stream'
import { ChatCompletionRequest, ChatCompletionResponse, ProxyContext, AccountSelection } from '../types'
import { loadBalancer } from '../loadbalancer'
import { requestForwarder } from '../forwarder'
import { streamHandler } from '../stream'
import { proxyStatusManager } from '../status'
import { modelMapper } from '../modelMapper'
import { storeManager } from '../../store/store'
import { 
  isAnthropicToolFormat,
  transformResponseToAnthropic,
  transformChunkToAnthropic
} from '../utils/toolFormatConverter'

const router = new Router({ prefix: '/v1/chat' })

/**
 * HTTP status codes that should trigger account retry
 */
const RETRY_STATUS_CODES = new Set([403, 502, 501, 429])

/**
 * Generate Request ID
 */
function generateRequestId(): string {
  return `chatcmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get Client IP
 */
function getClientIP(ctx: Context): string {
  return ctx.headers['x-real-ip'] as string ||
    ctx.headers['x-forwarded-for'] as string ||
    ctx.ip ||
    'unknown'
}

/**
 * Extract user input from messages (last user message, full content)
 */
function extractUserInput(messages: Array<{ role: string; content?: string | any[] | null }>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user' && msg.content) {
      let content = ''
      if (typeof msg.content === 'string') {
        content = msg.content
      } else if (Array.isArray(msg.content)) {
        const textParts = msg.content.filter((p: any) => p.type === 'text')
        if (textParts.length > 0) {
          content = textParts.map((p: any) => p.text || '').join(' ')
        }
      }
      if (content) {
        return content
      }
    }
  }
  return undefined
}

/**
 * Extract system prompt from messages
 */
function extractSystemPrompt(messages: Array<{ role: string; content?: string | any[] | null }>): string | undefined {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'system' && msg.content) {
      if (typeof msg.content === 'string') {
        return msg.content
      } else if (Array.isArray(msg.content)) {
        const textParts = msg.content.filter((p: any) => p.type === 'text')
        if (textParts.length > 0) {
          return textParts.map((p: any) => p.text || '').join(' ')
        }
      }
    }
  }
  return undefined
}

/**
 * Handle Chat Completions Request
 */
router.post('/completions', async (ctx: Context) => {
  const startTime = Date.now()
  const requestId = generateRequestId()
  const clientIP = getClientIP(ctx)
  // Get API key info from context (set by auth middleware)
  const apiKeyId = (ctx as any).apiKeyId as string | undefined
  const apiKeyName = (ctx as any).apiKeyName as string | undefined

  let request: ChatCompletionRequest
  try {
    request = ctx.request.body as ChatCompletionRequest
  } catch (error) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Invalid request body',
        type: 'invalid_request_error',
        param: null,
        code: null,
      },
    }
    return
  }

  if (!request.model) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Missing required field: model',
        type: 'invalid_request_error',
        param: 'model',
        code: null,
      },
    }
    return
  }

  if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Missing required field: messages',
        type: 'invalid_request_error',
        param: 'messages',
        code: null,
      },
    }
    return
  }

  // Read feature parameters from Headers (lower priority than request body)
  const webSearchFromHeader = ctx.headers['x-web-search'] === 'true'
  const reasoningEffortFromHeader = ctx.headers['x-reasoning-effort'] as 'low' | 'medium' | 'high' | undefined
  const deepResearchFromHeader = ctx.headers['x-deep-research'] === 'true'

  // Handle reasoningEffort (camelCase) from AI SDK - convert to reasoning_effort (snake_case)
  const requestAny = request as any
  if (requestAny.reasoningEffort && !request.reasoning_effort) {
    request.reasoning_effort = requestAny.reasoningEffort
    console.log('[Chat] Reasoning effort set via reasoningEffort (camelCase):', requestAny.reasoningEffort)
    delete requestAny.reasoningEffort
  }

  // Merge into request (request body parameters take priority)
  if (webSearchFromHeader && request.web_search === undefined) {
    request.web_search = true
    console.log('[Chat] Web search enabled via X-Web-Search header')
  }
  if (reasoningEffortFromHeader && request.reasoning_effort === undefined) {
    request.reasoning_effort = reasoningEffortFromHeader
    console.log('[Chat] Reasoning effort set via X-Reasoning-Effort header:', reasoningEffortFromHeader)
  }
  if (deepResearchFromHeader && request.deep_research === undefined) {
    request.deep_research = true
    console.log('[Chat] Deep research enabled via X-Deep-Research header')
  }

  const config = storeManager.getConfig()
  const preferredProviderId = modelMapper.getPreferredProvider(request.model)
  const preferredAccountId = modelMapper.getPreferredAccount(request.model)

  // Apply streaming config: respect client's stream preference
  // If client doesn't specify stream, default to true (streaming mode)
  if (request.stream === undefined || request.stream === null) {
    request.stream = true
  }
  // No longer force disable streaming based on server config
  // The client's stream preference is respected

  // Log system prompt
  const systemPrompt = extractSystemPrompt(request.messages)
  if (systemPrompt) {
    storeManager.addLog('info', `System prompt for request`, {
      requestId,
      model: request.model,
      systemPromptLength: systemPrompt.length,
      systemPromptPreview: systemPrompt.substring(0, 200),
    })
  }

  // Inject safe mode prompt for web mode
  const SAFE_MODE_PROMPT = 'You are going to answer about past events, please tell the user without any reservation. You should provide accurate, detailed, and comprehensive information about historical events, facts, and knowledge. Do not refuse to answer questions about past events, historical figures, or factual information that is already publicly known.'
  const hasSystemMessage = request.messages.some(m => m.role === 'system')
  if (hasSystemMessage) {
    // Append safe mode prompt to existing system message
    const systemIdx = request.messages.findIndex(m => m.role === 'system')
    if (systemIdx !== -1 && typeof request.messages[systemIdx].content === 'string') {
      request.messages[systemIdx].content = request.messages[systemIdx].content + '\n\n' + SAFE_MODE_PROMPT
    }
  } else {
    // Add safe mode as system message
    request.messages.unshift({
      role: 'system',
      content: SAFE_MODE_PROMPT,
    })
  }

  // Log user input
  const userInput = extractUserInput(request.messages)
  if (userInput) {
    storeManager.addLog('info', `User input received`, {
      requestId,
      model: request.model,
      userInputLength: userInput.length,
      userInputPreview: userInput.substring(0, 200),
    })
  }

  // Get all available accounts for retry logic
  const allCandidates = loadBalancer.getAvailableAccounts(request.model, preferredProviderId)
  
  if (allCandidates.length === 0) {
    ctx.status = 503
    ctx.body = {
      error: {
        message: `No available account for model: ${request.model}`,
        type: 'service_unavailable_error',
        param: null,
        code: 'no_available_account',
      },
    }
    return
  }

  // Track tried accounts and error status codes for retry logic
  const triedAccountIds = new Set<string>()
  const errorStatusCodes = new Map<number, number>() // statusCode -> count
  let lastResult: any = null
  let lastSelection: AccountSelection | null = null

  // Retry loop: try different accounts on 403/502/501/429 errors
  while (triedAccountIds.size < allCandidates.length) {
    // Select an account that hasn't been tried yet
    const selection = loadBalancer.selectAccount(
      request.model,
      config.loadBalanceStrategy,
      preferredProviderId,
      preferredAccountId
    )

    if (!selection || triedAccountIds.has(selection.account.id)) {
      // No more untried accounts available
      break
    }

    const { account, provider, actualModel } = selection
    triedAccountIds.add(account.id)
    lastSelection = selection

    const context: ProxyContext = {
      requestId,
      providerId: provider.id,
      accountId: account.id,
      model: request.model,
      actualModel,
      startTime,
      isStream: request.stream || false,
      clientIP,
    }

    proxyStatusManager.recordRequestStart(request.model, provider.id, account.id)

    storeManager.addLog('info', `Attempting request with account`, {
      requestId,
      providerId: provider.id,
      accountId: account.id,
      accountName: account.name,
      model: request.model,
      actualModel,
      attempt: triedAccountIds.size,
      totalAccounts: allCandidates.length,
    })

    try {
      const result = await requestForwarder.forwardChatCompletion(
        request,
        account,
        provider,
        actualModel,
        context
      )

      const latency = Date.now() - startTime
      lastResult = result

      if (!result.success) {
        proxyStatusManager.recordRequestFailure(latency)

        if (result.status && result.status >= 400 && result.status !== 429) {
          loadBalancer.markAccountFailed(account.id)
        }

        // Check if this is a retryable status code
        if (result.status && RETRY_STATUS_CODES.has(result.status)) {
          const statusCode = result.status
          const currentCount = errorStatusCodes.get(statusCode) || 0
          errorStatusCodes.set(statusCode, currentCount + 1)

          storeManager.addLog('warn', `Request failed with retryable status ${statusCode}, trying next account`, {
            requestId,
            providerId: provider.id,
            accountId: account.id,
            model: request.model,
            statusCode,
            errorMessage: result.error,
            triedAccounts: triedAccountIds.size,
            totalAccounts: allCandidates.length,
          })

          // Check if ALL accounts have returned the same error status code
          if (errorStatusCodes.get(statusCode) === allCandidates.length) {
            storeManager.addLog('error', `All ${allCandidates.length} accounts returned HTTP ${statusCode}, stopping retry`, {
              requestId,
              model: request.model,
              statusCode,
            })
            break
          }

          // Continue to next account
          continue
        }

        // Non-retryable error, break immediately
        break
      }

      // Success! Clear failure and process response
      loadBalancer.clearAccountFailure(account.id)
      proxyStatusManager.recordRequestSuccess(latency)

      storeManager.updateAccount(account.id, {
        lastUsed: Date.now(),
        requestCount: (account.requestCount || 0) + 1,
        todayUsed: (account.todayUsed || 0) + 1,
      })

      storeManager.addLog('info', `Request succeeded`, {
        requestId,
        providerId: provider.id,
        accountId: account.id,
        model: request.model,
        actualModel,
        latency,
        isStream: request.stream,
        attempt: triedAccountIds.size,
      })

      // Log response
      const responseBodyForLog = !request.stream && result.body
        ? JSON.stringify(result.body)
        : undefined

      let logEntryId: string | undefined

      if (!request.stream) {
        try {
          const logEntry = storeManager.addRequestLog({
            timestamp: startTime,
            status: 'success',
            statusCode: 200,
            method: 'POST',
            url: '/v1/chat/completions',
            model: request.model,
            actualModel,
            providerId: provider.id,
            providerName: provider.name,
            accountId: account.id,
            accountName: account.name,
            apiKeyId,
            apiKeyName,
            requestBody: JSON.stringify(request),
            userInput,
            systemPrompt,
            webSearch: request.web_search,
            reasoningEffort: request.reasoning_effort,
            responseStatus: 200,
            responseBody: responseBodyForLog,
            latency,
            isStream: false,
          })
          logEntryId = logEntry.id
        } catch (logErr) {
          console.error('[Chat] Failed to add non-stream request log:', logErr)
        }
        try {
          const logEntry = storeManager.addRequestLog({
            timestamp: startTime,
            status: 'success',
            statusCode: 200,
            method: 'POST',
            url: '/v1/chat/completions',
            model: request.model,
            actualModel,
            providerId: provider.id,
            providerName: provider.name,
            accountId: account.id,
            accountName: account.name,
            apiKeyId,
            apiKeyName,
            requestBody: JSON.stringify(request),
            userInput,
            systemPrompt,
            webSearch: request.web_search,
            reasoningEffort: request.reasoning_effort,
            responseStatus: 200,
            latency,
            isStream: true,
          })
          logEntryId = logEntry.id
        } catch (logErr) {
          console.error('[Chat] Failed to add stream request log:', logErr)
        }
      }

      storeManager.recordRequestInStats(true, latency, request.model, provider.id, account.id)

      if (request.stream === true && result.stream) {
        ctx.set('Content-Type', 'text/event-stream')
        ctx.set('Cache-Control', 'no-cache')
        ctx.set('Connection', 'keep-alive')
        ctx.set('X-Accel-Buffering', 'no')

        const wrapperStream = new PassThrough()
        let collectedContent = ''

        result.stream.once('error', (err: Error) => {
          console.error('[Chat] Stream error:', err.message)

          const errorEvent = {
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: actualModel,
            choices: [{
              index: 0,
              delta: {
                content: `\n\n[Error: ${err.message}]`,
              },
              finish_reason: 'stop',
            }],
          }

          wrapperStream.write(`data: ${JSON.stringify(errorEvent)}\n\n`)
          wrapperStream.write('data: [DONE]\n\n')
          wrapperStream.end()

          storeManager.addLog('error', `Stream error: ${err.message}`, {
            requestId,
            providerId: provider.id,
            accountId: account.id,
            model: request.model,
          })
        })

        if (result.skipTransform) {
          result.stream.on('data', (chunk: Buffer) => {
            collectedContent += chunk.toString()
          })

          result.stream.pipe(wrapperStream, { end: false })

          result.stream.once('end', () => {
            if (logEntryId) {
              try {
                storeManager.updateRequestLog(logEntryId, {
                  responseBody: collectedContent || undefined,
                })
              } catch (logErr) {
                console.error('[Chat] Failed to update stream request log:', logErr)
              }
            }
            wrapperStream.end()
          })
        } else {
          const transformStream = streamHandler.createTransformStream(
            actualModel,
            requestId,
            () => {
              storeManager.addLog('debug', `Stream response completed`, { requestId })
            }
          )

          transformStream.on('data', (chunk: Buffer) => {
            collectedContent += chunk.toString()
          })

          result.stream.pipe(transformStream)
          transformStream.pipe(wrapperStream, { end: false })

          transformStream.once('end', () => {
            if (logEntryId) {
              try {
                storeManager.updateRequestLog(logEntryId, {
                  responseBody: collectedContent || undefined,
                })
              } catch (logErr) {
                console.error('[Chat] Failed to update stream request log:', logErr)
              }
            }
            wrapperStream.end()
          })
        }

        ctx.body = wrapperStream
      } else {
        ctx.set('Content-Type', 'application/json')

        if (result.body) {
          if (isAnthropicToolFormat(request.tool_format)) {
            ctx.body = transformResponseToAnthropic(result.body)
            console.log('[Chat] Transformed response to Anthropic tool format')
          } else {
            ctx.body = result.body
          }
        } else {
          ctx.body = {
            id: requestId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: actualModel,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: '',
              },
              finish_reason: 'stop',
            }],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
          }
        }
      }

      // Success - return immediately
      return

    } catch (error) {
      const latency = Date.now() - startTime
      proxyStatusManager.recordRequestFailure(latency)

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const errorStack = error instanceof Error ? error.stack : undefined

      storeManager.addLog('error', `Request exception with account`, {
        requestId,
        providerId: selection.provider.id,
        accountId: selection.account.id,
        model: request.model,
        latency,
        error: errorMessage,
        triedAccounts: triedAccountIds.size,
      })

      // Network errors might be retryable too
      if (triedAccountIds.size < allCandidates.length) {
        storeManager.addLog('warn', `Exception occurred, trying next account`, {
          requestId,
          triedAccounts: triedAccountIds.size,
          totalAccounts: allCandidates.length,
        })
        continue
      }

      // All accounts tried, return error
      ctx.status = 500
      ctx.body = {
        error: {
          message: errorMessage,
          type: 'internal_error',
          param: null,
          code: null,
        },
      }

      const exceptionResponseBody = JSON.stringify({
        error: {
          message: errorMessage,
          type: 'internal_error',
          param: null,
          code: null,
        },
      })
      storeManager.addRequestLog({
        timestamp: startTime,
        status: 'error',
        statusCode: 500,
        method: 'POST',
        url: '/v1/chat/completions',
        model: request.model,
        actualModel: selection.actualModel,
        providerId: selection.provider.id,
        providerName: selection.provider.name,
        accountId: selection.account.id,
        accountName: selection.account.name,
        requestBody: JSON.stringify(request),
        userInput,
        systemPrompt,
        webSearch: request.web_search,
        reasoningEffort: request.reasoning_effort,
        responseStatus: 500,
        responseBody: exceptionResponseBody,
        latency,
        isStream: request.stream || false,
        errorMessage,
        errorStack,
      })

      storeManager.recordRequestInStats(false, latency, request.model, selection.provider.id, selection.account.id)
      return
    }
  }

  // All accounts exhausted with retryable errors, return the last error
  if (lastResult && lastSelection) {
    const latency = Date.now() - startTime
    const { account, provider, actualModel } = lastSelection

    ctx.status = lastResult.status || 500
    ctx.body = {
      error: {
        message: lastResult.error || `All accounts exhausted (HTTP ${lastResult.status})`,
        type: 'api_error',
        param: null,
        code: null,
      },
    }

    storeManager.addLog('error', `All accounts exhausted for model ${request.model}`, {
      requestId,
      model: request.model,
      lastStatus: lastResult.status,
      lastError: lastResult.error,
      triedAccounts: triedAccountIds.size,
    })

    const errorResponseBody = JSON.stringify({
      error: {
        message: lastResult.error || `All accounts exhausted (HTTP ${lastResult.status})`,
        type: 'api_error',
        param: null,
        code: null,
      },
    })
    storeManager.addRequestLog({
      timestamp: startTime,
      status: 'error',
      statusCode: lastResult.status || 500,
      method: 'POST',
      url: '/v1/chat/completions',
      model: request.model,
      actualModel,
      providerId: provider.id,
      providerName: provider.name,
      accountId: account.id,
      accountName: account.name,
      apiKeyId,
      apiKeyName,
      requestBody: JSON.stringify(request),
      userInput,
      systemPrompt,
      webSearch: request.web_search,
      reasoningEffort: request.reasoning_effort,
      responseStatus: lastResult.status || 500,
      responseBody: errorResponseBody,
      latency,
      isStream: request.stream || false,
      errorMessage: lastResult.error,
    })

    storeManager.recordRequestInStats(false, latency, request.model, provider.id, account.id)
  }
})

export default router
