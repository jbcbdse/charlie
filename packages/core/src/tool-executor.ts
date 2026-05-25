import { ITool } from "./base-tool";
import { EventName } from "./event-producer";
import { ChatAgentContext, MessageTool, MessageToolCall } from "./types";

/**
 * All Agents should use this class to execute tools
 */
export class ToolExecutor {
  /**
   * Give a tool call message, which may contain multiple tool calls, execute each tool call and return the results
   */
  public async execute(
    toolCallMessage: MessageToolCall,
    tools: ITool[],
    context: ChatAgentContext,
  ): Promise<MessageTool[]> {
    const toolMessages = await Promise.all(
      toolCallMessage.toolCalls.map(async (toolCall) => {
        const tool = tools.find((t) => t.name === toolCall.function.name);
        if (!tool) {
          return {
            role: "tool" as const,
            content: `Tool not found: ${toolCall.function.name}`,
            toolCallId: toolCall.id,
            name: toolCall.function.name,
            status: "error" as const,
            returnDirect: false,
          };
        }
        const toolStartMs = Date.now();
        context.eventProducer.emit(EventName.ToolStart, {
          context,
          startTime: toolStartMs,
          toolCall: toolCallMessage,
          toolCallId: toolCall.id,
        });
        const toolMessage = await tool
          .handle(toolCall.function.arguments, context)
          .then((toolResult) => ({
            role: "tool" as const,
            content: toolResult,
            toolCallId: toolCall.id,
            name: tool.name,
            status: "success" as const,
            returnDirect: tool.returnDirect || false,
          }))
          .catch((err) => ({
            role: "tool" as const,
            content: `Error in tool ${tool.name}: ${err.message}`,
            toolCallId: toolCall.id,
            name: tool.name,
            status: "error" as const,
            returnDirect: false,
          }));
        context.eventProducer.emit(EventName.ToolEnd, {
          context,
          startTime: toolStartMs,
          timeMs: Date.now() - toolStartMs,
          toolCall: toolCallMessage,
          toolCallId: toolCall.id,
          toolMessage: toolMessage,
        });
        return toolMessage;
      }),
    );
    return toolMessages;
  }
}
