import { randomUUID } from "node:crypto";
import type {
  ChatAgentContext,
  EventProducer,
  ITool,
} from "@jbcbdse/charlie-core";

/**
 * Builds a ChatAgentContext for one MCP tools/call. There is no chat loop or
 * LLM turn behind an MCP call, so history is empty and each call gets its own
 * runId. `ToolStart`/`ToolEnd` are emitted by Charlie's `ToolExecutor` around
 * a chat-loop tool call, which this bypasses — they do not fire here. A tool
 * handler that emits `ToolProgress`/`Log` itself via `context.eventProducer`
 * is still observable by whatever subscribed to the shared `eventProducer`
 * passed in (see `createCharlieMcpServerFactory`'s `eventProducer` option).
 */
export function buildToolCallContext(
  tools: ITool[],
  toolName: string,
  eventProducer: EventProducer,
): ChatAgentContext {
  return {
    runId: randomUUID(),
    modelId: "mcp-server",
    messages: [],
    tools,
    meta: {},
    eventProducer,
    toolName,
  };
}
