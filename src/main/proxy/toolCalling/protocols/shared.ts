import type { NormalizedToolDefinition, NormalizedToolResult, ToolParseResult, ToolProtocolId } from '../types.ts'
import type { ToolProtocolDetection } from './base.ts'
import type { ToolCall } from '../../types.ts'

export function detectMarkers(buffer: string, markers: string[]): ToolProtocolDetection {
  let earliest = -1
  for (const marker of markers) {
    const index = buffer.indexOf(marker)
    if (index !== -1 && (earliest === -1 || index < earliest)) {
      earliest = index
    }
  }

  if (earliest !== -1) {
    return { matched: true, partial: false, markerStart: earliest }
  }

  for (let index = 0; index < buffer.length; index += 1) {
    const suffix = buffer.slice(index)
    if (markers.some((marker) => marker.startsWith(suffix))) {
      return { matched: false, partial: true, markerStart: index }
    }
  }

  return { matched: false, partial: false }
}

export function stripFencedCodeBlocks(content: string): string {
  // Extract content from fenced code blocks instead of removing them entirely
  // GLM sometimes wraps tool calls in ```text...``` blocks
  return content.replace(/```(?:\w*)\n?([\s\S]*?)```/g, '$1')
}

export function toolNames(tools: NormalizedToolDefinition[]): Set<string> {
  return new Set(tools.map((tool) => tool.name))
}

export function createParseResult(input: {
  content: string
  toolCalls: ToolCall[]
  protocol: ToolProtocolId | 'unknown'
  rawMatches: string[]
  invalidToolNames?: string[]
  malformedReason?: string
}): ToolParseResult {
  return {
    content: input.content,
    toolCalls: input.toolCalls,
    protocol: input.protocol,
    rawMatches: input.rawMatches,
    malformedReason: input.malformedReason,
    invalidToolNames: input.invalidToolNames ?? [],
  }
}

export function buildToolCall(
  id: string,
  index: number,
  name: string,
  args: string,
  rawText?: string,
): ToolCall {
  return {
    id,
    index,
    type: 'function',
    function: {
      name,
      arguments: normalizeArguments(args),
    },
    ...(rawText ? { rawText } : {}),
  } as ToolCall
}

export function normalizeArguments(args: unknown): string {
  if (typeof args === 'string') {
    const trimmed = args.trim()
    if (!trimmed) return '{}'
    try {
      return JSON.stringify(JSON.parse(trimmed))
    } catch {
      // Fallback: try robust JSON parsing strategies (handles GLM edge cases)
      const parsed = tryRobustJsonParse(trimmed)
      if (parsed !== null) {
        return JSON.stringify(parsed)
      }
      return trimmed
    }
  }

  return JSON.stringify(args ?? {})
}

/**
 * Robust JSON parsing with multiple fallback strategies.
 * Handles common GLM output issues:
 * - Unescaped newlines/tabs inside string values
 * - Extra whitespace between JSON tokens
 * - Missing quotes around keys
 * - Single quotes instead of double quotes
 */
function tryRobustJsonParse(str: string): unknown | null {
  // Strategy 1: Fix unescaped newlines and tabs inside string values
  try {
    let inString = false
    let isEscaped = false
    let fixedStr = ''

    for (let i = 0; i < str.length; i++) {
      const char = str[i]

      if (char === '\\' && !isEscaped) {
        isEscaped = true
        fixedStr += char
      } else if (char === '"' && !isEscaped) {
        inString = !inString
        fixedStr += char
      } else if (inString && (char === '\n' || char === '\r' || char === '\t')) {
        if (char === '\n') fixedStr += '\\n'
        else if (char === '\r') fixedStr += '\\r'
        else if (char === '\t') fixedStr += '\\t'
      } else {
        isEscaped = false
        fixedStr += char
      }
    }

    return JSON.parse(fixedStr)
  } catch {
    // Continue to next strategy
  }

  // Strategy 2: Remove newlines and extra whitespace between JSON tokens
  try {
    let inString = false
    let isEscaped = false
    let compactStr = ''

    for (let i = 0; i < str.length; i++) {
      const char = str[i]

      if (char === '\\' && !isEscaped) {
        isEscaped = true
        compactStr += char
      } else if (char === '"' && !isEscaped) {
        inString = !inString
        compactStr += char
      } else if (!inString && (char === '\n' || char === '\r' || char === '\t')) {
        continue
      } else {
        isEscaped = false
        compactStr += char
      }
    }

    return JSON.parse(compactStr)
  } catch {
    // Continue to next strategy
  }

  // Strategy 3: Fix missing quotes around keys
  try {
    const fixedStr = str.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
    let inString = false
    let isEscaped = false
    let compactStr = ''

    for (let i = 0; i < fixedStr.length; i++) {
      const char = fixedStr[i]
      if (char === '\\' && !isEscaped) {
        isEscaped = true
        compactStr += char
      } else if (char === '"' && !isEscaped) {
        inString = !inString
        compactStr += char
      } else if (!inString && (char === '\n' || char === '\r')) {
        continue
      } else {
        isEscaped = false
        compactStr += char
      }
    }
    return JSON.parse(compactStr)
  } catch {
    // Continue to next strategy
  }

  // Strategy 4: Fix single quotes (Python dict style)
  try {
    const doubleQuotedStr = str.replace(/'/g, '"')
    return JSON.parse(doubleQuotedStr)
  } catch {
    // All strategies failed
  }

  return null
}

/**
 * Strip residual Chat2API XML tags from a string value.
 * These tags should never appear in legitimate parameter values.
 */
function stripChat2ApiTags(value: string): string {
  return value
    .replace(/<\|?CHAT2API\|?(parameter|invoke|tool_calls|tool_result)[^>]*>/gi, '')
    .replace(/<\/\|?CHAT2API\|?(parameter|invoke|tool_calls|tool_result)\s*>/gi, '')
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .trim()
}

export function parseJsonValue(value: string): unknown {
  const trimmed = unwrapCdata(value).trim()
  if (!trimmed) return ''

  // Safety net: strip any residual XML tags that might have leaked into the value
  const cleaned = stripChat2ApiTags(trimmed)
  if (cleaned !== trimmed) {
    // Only log if actual cleanup happened
    console.warn('[ToolParser] Stripped residual XML tags from parameter value. Before:', trimmed.substring(0, 100), 'After:', cleaned.substring(0, 100))
  }

  try {
    return JSON.parse(cleaned)
  } catch {
    return decodeXml(cleaned)
  }
}

export function unwrapCdata(value: string): string {
  const cdata = value.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  return cdata ? cdata[1] : value
}

export function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function addParameter(target: Record<string, unknown>, name: string, value: unknown): void {
  const existing = target[name]
  if (existing === undefined) {
    target[name] = value
  } else if (Array.isArray(existing)) {
    target[name] = [...existing, value]
  } else {
    target[name] = [existing, value]
  }
}

export function renderToolList(tools: NormalizedToolDefinition[]): string {
  return tools
    .map((tool) => {
      const parameters = JSON.stringify(tool.parameters ?? {})
      return `Tool \`${tool.name}\`: ${tool.description || 'No description'}. Arguments JSON schema: ${parameters}`
    })
    .join('\n')
}

export function genericToolResultBlock(result: NormalizedToolResult): string {
  return `[TOOL_RESULT for ${result.toolCallId}] ${result.content}`
}
