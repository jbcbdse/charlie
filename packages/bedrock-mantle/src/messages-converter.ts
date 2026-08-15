import { ChatMessage, MessageToolCall } from "@jbcbdse/charlie-core";

interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}
interface TextBlock {
  type: "text";
  text: string;
}
interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
interface RedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
}
type ContentBlockParam =
  | ThinkingBlock
  | RedactedThinkingBlock
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock;
export interface MantleMessageParam {
  role: "user" | "assistant";
  content: string | ContentBlockParam[];
}
interface ResponseBlock {
  type: string;
  thinking?: string;
  signature?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  data?: string;
}

export class MantleMessagesConverter {
  public toMessages(messages: ChatMessage[]): MantleMessageParam[] {
    const result: MantleMessageParam[] = [];
    let assistantBlocks: ContentBlockParam[] = [];
    let toolResults: ToolResultBlock[] = [];

    const flushAssistant = () => {
      if (assistantBlocks.length > 0) {
        result.push({ role: "assistant", content: assistantBlocks });
        assistantBlocks = [];
      }
    };
    const flushToolResults = () => {
      if (toolResults.length > 0) {
        result.push({ role: "user", content: toolResults });
        toolResults = [];
      }
    };

    for (const msg of messages) {
      if (msg.role === "system") {
        continue;
      }
      if (msg.role === "user") {
        flushAssistant();
        flushToolResults();
        result.push({ role: "user", content: msg.content });
        continue;
      }
      if (msg.role === "reasoning") {
        flushToolResults();
        if (msg.content && msg.signature) {
          assistantBlocks.push({
            type: "thinking",
            thinking: msg.content,
            signature: msg.signature,
          });
        } else if (!msg.content && msg.signature) {
          assistantBlocks.push({
            type: "redacted_thinking",
            data: msg.signature,
          });
        }
        continue;
      }
      if (msg.role === "assistant") {
        flushToolResults();
        if (msg.content) {
          assistantBlocks.push({ type: "text", text: msg.content });
        }
        continue;
      }
      if (msg.role === "tool_call") {
        flushToolResults();
        for (const toolCall of msg.toolCalls) {
          assistantBlocks.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: toolCall.function.arguments,
          });
        }
        continue;
      }
      if (msg.role === "tool") {
        flushAssistant();
        toolResults.push({
          type: "tool_result",
          tool_use_id: msg.toolCallId,
          content: msg.content,
          is_error: msg.status === "error",
        });
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`Unknown message role: ${(msg as any)?.role}`);
    }
    flushAssistant();
    flushToolResults();
    return this.mergeTurns(result);
  }

  public fromResponse(content: ResponseBlock[]): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const toolCalls: MessageToolCall["toolCalls"] = [];
    const flushToolCalls = () => {
      if (toolCalls.length > 0) {
        const toolCallMessage: MessageToolCall = {
          role: "tool_call",
          toolCalls: [...toolCalls],
        };
        messages.push(toolCallMessage);
        toolCalls.length = 0;
      }
    };
    for (const block of content) {
      if (block.type === "thinking" && block.thinking && block.signature) {
        flushToolCalls();
        messages.push({
          role: "reasoning",
          content: block.thinking,
          signature: block.signature,
        });
        continue;
      }
      if (block.type === "redacted_thinking" && block.data) {
        flushToolCalls();
        messages.push({
          role: "reasoning",
          signature: block.data,
        });
        continue;
      }
      if (block.type === "text" && block.text) {
        flushToolCalls();
        messages.push({ role: "assistant", content: block.text });
        continue;
      }
      if (block.type === "tool_use" && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: this.asRecord(block.input),
          },
        });
      }
    }
    flushToolCalls();
    return messages;
  }

  private mergeTurns(messages: MantleMessageParam[]): MantleMessageParam[] {
    const merged: MantleMessageParam[] = [];
    for (const msg of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) {
        last.content = [
          ...this.asBlocks(last.content),
          ...this.asBlocks(msg.content),
        ];
      } else {
        merged.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }
    return merged;
  }

  private asBlocks(content: string | ContentBlockParam[]): ContentBlockParam[] {
    return typeof content === "string"
      ? [{ type: "text", text: content }]
      : content;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  }
}
