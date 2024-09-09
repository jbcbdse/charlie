import { ChatMessage, ChatMessageTransformer } from "./types";

/**
 * If the chat contains a tool call, only return the tool call messages
 *
 * This is useful for LLMs that include an intermediate assistant message before the tool call but you want to remove that from the final output
 *
 * OpenAI's chat endpoint does not mix text assistant response with tool calls, but others do
 */
export class ToolAssistantFilter implements ChatMessageTransformer {
  public transform(messages: ChatMessage[]): ChatMessage[] {
    if (messages.some((msg) => msg.role === "tool_call")) {
      return messages.filter((msg) => msg.role === "tool_call");
    }
    return messages;
  }
}
