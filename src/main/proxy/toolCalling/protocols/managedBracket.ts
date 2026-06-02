import type { ToolProtocolAdapter } from './base.ts'
import type { ToolParseContext } from '../types.ts'
import {
  buildToolCall,
  createParseResult,
  genericToolResultBlock,
  detectMarkers,
  renderToolList,
  stripFencedCodeBlocks,
  toolNames,
} from './shared.ts'

const START_MARKER = '[function_calls]'
const END_MARKER = '[/function_calls]'

export const managedBracketProtocol: ToolProtocolAdapter = {
  id: 'managed_bracket',

  renderPrompt(tools) {
    const toolListStr = renderToolList(tools)
    const exampleToolName = tools.length > 0 ? tools[0].name : 'tool_name'
    const exampleParam = tools.length > 0 && tools[0].parameters?.properties
      ? Object.keys(tools[0].parameters.properties)[0] || 'param'
      : 'param'

    return `## Available Tools
You have access to the following developer tools. Tool names are case-sensitive.

${toolListStr}

## CRITICAL RULES FOR TOOL USAGE
1. When a user request can be fulfilled by one or more of the available tools, you MUST call the appropriate tool(s) instead of responding with plain text.
2. NEVER refuse or apologize when a tool is available to fulfill the request. Do NOT say "I cannot", "I'm unable to", "I don't have access to", or "I'm sorry, I can't help with that" when a relevant tool exists.
3. If you are unsure whether a tool can help, TRY the tool first rather than refusing.
4. Always call tools with the EXACT tool names and parameter names as defined above.
5. When multiple tools are needed, include multiple [call:...] blocks inside ONE [function_calls] block.

## OUTPUT FORMAT (STRICT - FOLLOW EXACTLY)
When you decide to call a tool, respond with **NOTHING** except a single [function_calls] block. No reasoning, no thinking, no extra words before or after.

Format:
[function_calls]
[call:exact_tool_name]{"${exampleParam}":"value"}[/call]
[/function_calls]

Example with "${exampleToolName}":
[function_calls]
[call:${exampleToolName}]{"${exampleParam}":"example value"}[/call]
[/function_calls]

CRITICAL FORMAT RULES:
- Start with [call:exact_tool_name] (MUST include prefixes like default_api: if present in the tool name)
- Then the JSON arguments ALL ON ONE LINE - NO NEWLINES inside JSON
- JSON must be properly escaped. Do not add markdown or extra text around the block
- Close each call with [/call]
- If you are writing code or regular expressions, you MUST properly escape all backslashes and quotes inside the JSON string

After receiving tool results, you MUST synthesize the results and provide a helpful response to the user. Do NOT simply repeat the raw tool output.`
  },

  detectStart(buffer) {
    return detectMarkers(buffer, [START_MARKER])
  },

  parse(content: string, context: ToolParseContext) {
    let parseable = stripFencedCodeBlocks(content)
    const allowedNames = toolNames(context.tools)
    const rawMatches: string[] = []
    const invalidToolNames: string[] = []
    const toolCalls = []

    // Handle missing opening bracket: "function_calls]" -> "[function_calls]"
    // GLM sometimes outputs without the opening bracket
    const missingBracketRegex = /(^|[^/\[])(function_calls\])/g
    if (!parseable.includes('[function_calls]') && missingBracketRegex.test(parseable)) {
      parseable = parseable.replace(/(^|[^/\[])(function_calls\])/g, '$1[$2')
      console.log('[ManagedBracket] Prepended opening bracket for GLM compatibility')
    }

    // Also handle unclosed [function_calls] blocks (streaming or malformed output)
    const blockPattern = /\[function_calls\]([\s\S]*?)(?:\[\/function_calls\]|$)/g
    let blockMatch: RegExpExecArray | null

    while ((blockMatch = blockPattern.exec(parseable)) !== null) {
      rawMatches.push(blockMatch[0])
      // Support [call:name], [call:=name], [call := name] formats for GLM compatibility
      const callPattern = /\[call\s*[:=]+\s*([^\]]+)\]([\s\S]*?)\[\/call\]/g
      let callMatch: RegExpExecArray | null

      while ((callMatch = callPattern.exec(blockMatch[1])) !== null) {
        let name = callMatch[1].trim()
        name = name.replace(/<\|chat2api\|/g, '').replace(/\|chat2api\|>/g, '')
        if (!allowedNames.has(name)) {
          invalidToolNames.push(name)
          continue
        }

        toolCalls.push(buildToolCall(`call_${toolCalls.length}`, toolCalls.length, name, callMatch[2], callMatch[0]))
      }
    }

    if (toolCalls.length === 0) {
      return createParseResult({
        content,
        toolCalls,
        protocol: rawMatches.length > 0 ? 'managed_bracket' : 'unknown',
        rawMatches,
        invalidToolNames,
      })
    }

    const cleanContent = rawMatches.reduce((acc, raw) => acc.replace(raw, ''), parseable).trim()
    return createParseResult({
      content: cleanContent,
      toolCalls,
      protocol: 'managed_bracket',
      rawMatches,
      invalidToolNames,
    })
  },

  formatAssistantToolCalls(calls) {
    const body = calls.map((call) => `[call:${call.name}]${call.arguments}[/call]`).join('\n')
    return `${START_MARKER}\n${body}\n${END_MARKER}`
  },

  formatToolResult(result) {
    return genericToolResultBlock(result)
  },
}
