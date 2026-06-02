/**
 * AstrBot Tool Client Adapter
 * Supports AstrBot-style tool calling with:
 * - Standard OpenAI function calling format
 * - MCP tool integration (mcp-- prefix)
 * - Duplicate tool call deduplication
 * - Skill viewing optimization
 */

import type { ChatCompletionRequest, ChatCompletionTool } from '../../types.ts'
import type { NormalizedToolDefinition } from '../types.ts'
import type { NormalizedClientToolRequest, NormalizedToolChoice, ToolClientAdapter } from './types.ts'
import { normalizeOpenAiTools, normalizeToolChoice } from './standardOpenAiTools.ts'

/**
 * Normalize MCP tools from AstrBot format
 * AstrBot MCP tools are prefixed with "mcp--" in the name
 * e.g., mcp--shipyard___neo--create_sandbox
 */
function normalizeMcpTools(
  tools: ChatCompletionTool[] | undefined,
): NormalizedToolDefinition[] {
  return (tools ?? [])
    .filter((tool) => tool.type === 'function' && Boolean(tool.function?.name))
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters ?? {},
      source: 'mcp' as const,
    }))
}

/**
 * Detect if tools include MCP tools (prefixed with mcp--)
 */
function hasMcpTools(tools: ChatCompletionTool[] | undefined): boolean {
  return (tools ?? []).some(
    (tool) => tool.type === 'function' && tool.function?.name?.startsWith('mcp--')
  )
}

/**
 * Deduplicate tools by name (keep first occurrence)
 * This prevents the same tool from being called multiple times with the same arguments
 */
function deduplicateTools(tools: NormalizedToolDefinition[]): NormalizedToolDefinition[] {
  const seen = new Set<string>()
  return tools.filter((tool) => {
    if (seen.has(tool.name)) return false
    seen.add(tool.name)
    return true
  })
}

/**
 * Optimize skill tools for viewing
 * Skill tools in AstrBot have descriptions that can be very long
 * We truncate descriptions for better readability
 */
function optimizeSkillTools(tools: NormalizedToolDefinition[]): NormalizedToolDefinition[] {
  return tools.map((tool) => {
    // For MCP tools, keep full description as they contain usage instructions
    if (tool.name.startsWith('mcp--')) {
      return tool
    }
    // For skill tools, if description is very long, truncate for readability
    if (tool.description && tool.description.length > 500) {
      return {
        ...tool,
        description: tool.description.substring(0, 500) + '...',
      }
    }
    return tool
  })
}

export const astrBotAdapter: ToolClientAdapter = {
  id: 'astrbot',
  displayName: 'AstrBot',

  normalizeRequest(request): NormalizedClientToolRequest {
    // Normalize both OpenAI and MCP tools
    const openAiTools = normalizeOpenAiTools(request.tools, 'openai')
    const mcpTools = normalizeMcpTools(request.tools)
    
    // Merge all tools
    let allTools = [...openAiTools, ...mcpTools]
    
    // Deduplicate tools by name
    allTools = deduplicateTools(allTools)
    
    // Optimize skill tools for viewing
    allTools = optimizeSkillTools(allTools)

    const toolChoice = normalizeToolChoice(
      request,
      new Set(allTools.map((tool) => tool.name))
    )

    const hasMcp = hasMcpTools(request.tools)

    return {
      clientAdapterId: 'astrbot',
      toolSource: hasMcp ? 'mcp' : (allTools.length > 0 ? 'openai' : 'none'),
      tools: allTools,
      toolChoice,
      diagnostics: {
        rawToolCount: request.tools?.length ?? 0,
        normalizedToolNames: allTools.map((tool) => tool.name),
        detectedClientType: hasMcp ? 'astrbot-mcp' : 'astrbot',
      },
    }
  },
}
