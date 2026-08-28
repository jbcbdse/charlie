import {
  Attachment,
  attachmentBase64,
  ChatMessage,
  MessageToolCall,
  messageTextWithPlaceholders,
  textWithUnsupportedAttachments,
} from "@jbcbdse/charlie-core";

interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}
interface TextBlock {
  type: "text";
  text: string;
}
interface ImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
}
interface DocumentBlock {
  type: "document";
  source: {
    type: "base64";
    media_type: "application/pdf";
    data: string;
  };
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
  content: string | (TextBlock | ImageBlock | DocumentBlock)[];
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
  | ImageBlock
  | DocumentBlock
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
  source?: { media_type?: string; data?: string };
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
        result.push({
          role: "user",
          content: this.toUserContent(msg.content, msg.attachments),
        });
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
        const text = messageTextWithPlaceholders(msg);
        if (text) {
          assistantBlocks.push({ type: "text", text });
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
          content: this.toUserContent(msg.content, msg.attachments),
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
      if (block.type === "image" && block.source) {
        flushToolCalls();
        const source = block.source as {
          media_type?: string;
          data?: string;
        };
        if (source.data) {
          const last = messages[messages.length - 1];
          const attachment: Attachment = {
            mimeType: source.media_type ?? "image/png",
            data: source.data,
          };
          if (last?.role === "assistant") {
            last.attachments = [...(last.attachments ?? []), attachment];
          } else {
            messages.push({
              role: "assistant",
              content: "",
              attachments: [attachment],
            });
          }
        }
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

  private toUserContent(
    text: string,
    attachments?: Attachment[],
  ): string | (TextBlock | ImageBlock | DocumentBlock)[] {
    if (!attachments?.length) {
      return text;
    }
    return this.toMediaBlocks(text, attachments);
  }

  private toMediaBlocks(
    text: string,
    attachments?: Attachment[],
  ): (TextBlock | ImageBlock | DocumentBlock)[] {
    const blocks: (TextBlock | ImageBlock | DocumentBlock)[] = [];
    const unsupported: Attachment[] = [];
    for (const attachment of attachments ?? []) {
      const mime = attachment.mimeType.toLowerCase();
      const imageMedia = this.anthropicImageMedia(mime);
      if (imageMedia) {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: imageMedia,
            data: attachmentBase64(attachment),
          },
        });
      } else if (mime === "application/pdf") {
        blocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: attachmentBase64(attachment),
          },
        });
      } else {
        unsupported.push(attachment);
      }
    }
    const withPlaceholders = textWithUnsupportedAttachments(text, unsupported);
    if (withPlaceholders) {
      blocks.unshift({ type: "text", text: withPlaceholders });
    }
    return blocks;
  }

  private anthropicImageMedia(
    mimeType: string,
  ): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | undefined {
    const mime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    if (
      mime === "image/jpeg" ||
      mime === "image/png" ||
      mime === "image/gif" ||
      mime === "image/webp"
    ) {
      return mime;
    }
    return undefined;
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
