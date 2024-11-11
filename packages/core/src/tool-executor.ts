import { BaseTool } from "./base-tool";
import { EventName, eventProducer, EventProducer } from "./event-producer";
import { ChatAgentContext, MessageTool, MessageToolCall } from "./types";

/**
 * All Agents should use this class to execute tools
 */
export class ToolExecutor {
  private eventProducer: EventProducer;
  constructor() {
    this.eventProducer = eventProducer;
  }
  /**
   * Give a tool call message, which may contain multiple tool calls, execute each tool call and return the results
   */
  public async execute(
    toolCallMessage: MessageToolCall,
    tools: BaseTool[],
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
          };
        }
        const toolStartMs = Date.now();
        this.eventProducer.emit(EventName.ToolStart, {
          context,
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
          }))
          .catch((err) => ({
            role: "tool" as const,
            content: `Error in tool ${tool.name}: ${err.message}`,
            toolCallId: toolCall.id,
            name: tool.name,
            status: "error" as const,
          }));
        this.eventProducer.emit(EventName.ToolEnd, {
          context,
          timeMs: Date.now() - toolStartMs,
          toolMessage: toolMessage,
        });
        return toolMessage;
      }),
    );
    return toolMessages;
  }
}
