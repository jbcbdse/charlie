import {
  Attachment,
  AttachmentFormatter,
  ChatMessage,
} from "@jbcbdse/charlie-core";
import { ContentBlock, Message } from "@aws-sdk/client-bedrock-runtime";
import { toBedrockContentBlocks } from "./content-blocks";

export class MessageConverter {
  private toolsSupported: boolean;
  private attachmentFormatter: AttachmentFormatter;
  public constructor(options: {
    toolsSupported: boolean;
    attachmentFormatter?: AttachmentFormatter;
  }) {
    this.toolsSupported = options.toolsSupported ?? true;
    this.attachmentFormatter =
      options.attachmentFormatter ?? new AttachmentFormatter();
  }
  public toBedrockMessages(messages: ChatMessage[]): Message[] {
    const bedrockMessages = messages
      .filter((msg) => msg.role !== "reasoning")
      .map(this.toBedrockMessage.bind(this));
    return this.normalizeBedrockMessages(bedrockMessages);
  }

  private contentBlocks(text: string, attachments?: Attachment[]) {
    return toBedrockContentBlocks(
      text,
      attachments,
      this.attachmentFormatter,
    );
  }

  private toBedrockMessage(msg: ChatMessage): Message {
    if (msg.role === "user") {
      const content = msg.content.replace(/<\/?system>/, "");
      return {
        role: "user",
        content: this.contentBlocks(content, msg.attachments),
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
        content: this.contentBlocks(
          this.attachmentFormatter.messageTextWithPlaceholders(msg),
        ),
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
          content: this.contentBlocks(
            `<system>${msg.status === "success" ? "Successful" : "Failed"} tool result for ${msg.name} tool call: ${msg.content}</system>`,
            msg.attachments,
          ),
        };
      }
      return {
        role: "user",
        content: [
          {
            toolResult: {
              content: this.contentBlocks(
                msg.content,
                msg.attachments,
              ) as NonNullable<
                NonNullable<ContentBlock["toolResult"]>["content"]
              >,
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
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
