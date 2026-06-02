import type { ToolProtocolAdapter } from './base.ts'
import {
  buildToolCall,
  createParseResult,
  genericToolResultBlock,
  detectMarkers,
  normalizeArguments,
  renderToolList,
  stripFencedCodeBlocks,
  toolNames,
} from './shared.ts'

export const codexResponsesProtocol: ToolProtocolAdapter = {
  id: 'codex_responses',

  renderPrompt(tools) {
    return `## Available Tools
You have access to the following developer tools. Tool names are case-sensitive.

${renderToolList(tools)}

## CRITICAL RULES FOR TOOL USAGE
1. When a user request can be fulfilled by one or more of the available tools, you MUST call the appropriate tool(s) instead of responding with plain text.
2. NEVER refuse or apologize when a tool is available to fulfill the request. Do NOT say "I cannot", "I'm unable to", "I don't have access to", or "I'm sorry, I can't help with that" when a relevant tool exists.
3. If you are unsure whether a tool can help, TRY the tool first rather than refusing.
4. Always call tools with the EXACT tool names and parameter names as defined above.

When Codex Responses compatibility is enabled, emit response items with type "function_call".`
  },

  detectStart(buffer) {
    return detectMarkers(buffer, ['"type":"function_call"', '"type": "function_call"', '{"type"'])
  },

  parse(content, context) {
    const parseable = stripFencedCodeBlocks(content).trim()
    const allowedNames = toolNames(context.tools)
    const rawMatches: string[] = []
    const invalidToolNames: string[] = []
    const toolCalls = []

    let parsed: unknown
    try {
      parsed = JSON.parse(parseable)
    } catch {
      return createParseResult({
        content,
        toolCalls,
        protocol: 'unknown',
        rawMatches,
        malformedReason: 'codex_responses_json_parse_failed',
      })
    }

    const items = extractResponseItems(parsed)
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      if (record.type !== 'function_call') continue

      const name = typeof record.name === 'string' ? record.name : ''
      if (!allowedNames.has(name)) {
        if (name) invalidToolNames.push(name)
        continue
      }

      const id =
        typeof record.call_id === 'string'
          ? record.call_id
          : typeof record.id === 'string'
            ? record.id
            : `call_${toolCalls.length}`

      toolCalls.push(buildToolCall(id, toolCalls.length, name, normalizeArguments(record.arguments), parseable))
    }

    if (toolCalls.length > 0) rawMatches.push(parseable)

    return createParseResult({
      content: toolCalls.length > 0 ? '' : content,
      toolCalls,
      protocol: toolCalls.length > 0 || invalidToolNames.length > 0 ? 'codex_responses' : 'unknown',
      rawMatches,
      invalidToolNames,
    })
  },

  formatAssistantToolCalls(calls) {
    return JSON.stringify(
      calls.map((call) => ({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
      })),
    )
  },

  formatToolResult(result) {
    return genericToolResultBlock(result)
  },
}

function extractResponseItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []

  const record = value as Record<string, unknown>
  if (record.type === 'function_call') return [record]
  if (Array.isArray(record.output)) return record.output
  if (Array.isArray(record.items)) return record.items
  return []
}
