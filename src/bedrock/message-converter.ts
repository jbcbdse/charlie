import { ChatMessage } from "../core/types";
import { Message } from "@aws-sdk/client-bedrock-runtime";

export class MessageConverter {
  private toolsSupported: boolean;
  public constructor(options: { toolsSupported: boolean }) {
    this.toolsSupported = options.toolsSupported ?? true;
  }
  public toBedrockMessages(messages: ChatMessage[]): Message[] {
    const bedrockMessages = messages.map(this.toBedrockMessage.bind(this));
    return this.normalizeBedrockMessages(bedrockMessages);
  }

  private toBedrockMessage(msg: ChatMessage): Message {
    if (msg.role === "user") {
      const content = msg.content.replace(/<\/?system>/, "");
      return {
        role: "user",
        content: [{ text: content }],
      };
    }
    if (msg.role === "system") {
      return {
        role: "user",
        content: [{ text: `<system>${msg.content}</system>` }],
      };
    }
    if (msg.role === "assistant") {
      return {
        role: "assistant",
        content: [{ text: msg.content }],
      };
    }
    if (msg.role === "tool_call") {
      type ContentBlock = NonNullable<Message["content"]>[0];
      type DocumentType = NonNullable<ContentBlock["toolUse"]>["input"];
      return {
        role: "assistant",
        content: msg.toolCalls.map(
          (call): ContentBlock =>
            this.toolsSupported
              ? {
                  toolUse: {
                    toolUseId: call.id,
                    name: call.function.name,
                    input: call.function.arguments as DocumentType,
                  },
                }
              : {
                  text: `Tool call:\n${JSON.stringify([{ name: call.function.name, arguments: call.function.arguments }])}`,
                },
        ),
      };
    }
    if (msg.role === "tool") {
      if (!this.toolsSupported) {
        return {
          role: "user",
          content: [
            {
              text: `<system>${msg.status === "success" ? "Successful" : "Failed"} tool result for ${msg.name} tool call: ${msg.content}</system>`,
            },
          ],
        };
      }
      return {
        role: "user",
        content: [
          {
            toolResult: {
              content: [{ text: msg.content }],
              toolUseId: msg.toolCallId,
              status: msg.status,
            },
          },
        ],
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error(`Unknown message role: ${(msg as any)?.role}`);
  }

  /**
   * Claude requires that the conversation must alternate between the user and the AI
   * This function combined consecutive messages from the same role into a single message
   * I don't know if this is needed (or even preferred) for other Bedrock models
   */
  private normalizeBedrockMessages(messages: Message[]): Message[] {
    const normalizedMessages: Message[] = [];
    let previousMessage: Message | undefined;
    for (const currentMessage of messages) {
      if (previousMessage) {
        if (currentMessage.role === previousMessage.role) {
          previousMessage.content!.push(...(currentMessage!.content || []));
        } else {
          previousMessage = currentMessage;
          normalizedMessages.push(previousMessage);
        }
      } else {
        previousMessage = currentMessage;
        normalizedMessages.push(previousMessage);
      }
    }
    return normalizedMessages;
  }
}
