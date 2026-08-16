import { EventName, StreamChunk } from "./event-producer";
import {
  ChatAgentContext,
  ChatAgentGetResponseOutput,
  ChatMessage,
  MessageReasoning,
  TokenUsage,
} from "./types";

export interface CharlieReasoningPart {
  type: "reasoning";
  id?: string;
  encryptedContent?: string;
  content?: string;
  signature?: string;
}

export interface CharlieUsagePart extends TokenUsage {
  type: "usage";
}

export interface CharlieErrorPart {
  type: "error";
  error: unknown;
}

export type CharlieStreamPart =
  | StreamChunk
  | CharlieReasoningPart
  | CharlieUsagePart
  | CharlieErrorPart;

export class CharlieStreamConsumer {
  private responseMessages: ChatMessage[] = [];
  private tools = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  private text = "";
  private usagePart: CharlieUsagePart | undefined;

  constructor(
    private readonly context: ChatAgentContext,
    private readonly meta: { modelId: string; modelProvider: string },
  ) {}

  public async consume(
    parts: AsyncIterable<CharlieStreamPart> | Iterable<CharlieStreamPart>,
  ): Promise<ChatAgentGetResponseOutput> {
    for await (const part of parts) {
      this.applyPart(part);
    }
    this.flushText();
    this.flushTools();
    if (this.responseMessages.length === 0) {
      this.responseMessages.push({ role: "assistant", content: "" });
    }
    const responseMessage =
      [...this.responseMessages]
        .reverse()
        .find((m) => m.role !== "reasoning") ??
      this.responseMessages[this.responseMessages.length - 1];
    return {
      responseMessage,
      responseMessages: this.responseMessages,
      usage: this.usagePart && this.toTokenUsage(this.usagePart),
    };
  }

  private applyPart(part: CharlieStreamPart): void {
    if (part.type === "error") {
      throw part.error instanceof Error
        ? part.error
        : new Error(String(part.error));
    }
    if (part.type === "usage") {
      this.usagePart = part;
      return;
    }
    if (part.type === "reasoning") {
      this.flushText();
      this.flushTools();
      const reasoning: MessageReasoning = { role: "reasoning" };
      if (part.id) reasoning.id = part.id;
      if (part.encryptedContent)
        reasoning.encryptedContent = part.encryptedContent;
      if (part.content) reasoning.content = part.content;
      if (part.signature) reasoning.signature = part.signature;
      this.responseMessages.push(reasoning);
      return;
    }
    if (part.type === "text") {
      this.text += part.text;
      this.emit(part);
      return;
    }
    if (part.type === "thinking") {
      this.emit(part);
      return;
    }
    const acc = this.tools.get(part.index) ?? {
      id: "",
      name: "",
      arguments: "",
    };
    if (part.id) acc.id = part.id;
    if (part.name) acc.name = part.name;
    if (part.argumentsText) acc.arguments += part.argumentsText;
    this.tools.set(part.index, acc);
    this.emit(part);
  }

  private emit(chunk: StreamChunk): void {
    this.context.eventProducer.emit(EventName.ChatStreamChunk, {
      context: this.context,
      modelId: this.meta.modelId,
      modelProvider: this.meta.modelProvider,
      chunk,
    });
  }

  private flushText(): void {
    if (!this.text) return;
    this.responseMessages.push({ role: "assistant", content: this.text });
    this.text = "";
  }

  private flushTools(): void {
    if (this.tools.size === 0) return;
    this.responseMessages.push({
      role: "tool_call",
      toolCalls: [...this.tools.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, toolCall]) => ({
          id: toolCall.id,
          type: "function" as const,
          function: {
            name: toolCall.name,
            arguments: this.parseArguments(toolCall.arguments),
          },
        })),
    });
    this.tools.clear();
  }

  private toTokenUsage(part: CharlieUsagePart): TokenUsage {
    const usage: TokenUsage = {
      inputTokens: part.inputTokens,
      outputTokens: part.outputTokens,
      totalTokens: part.totalTokens,
    };
    if (part.reasoningTokens !== undefined) {
      usage.reasoningTokens = part.reasoningTokens;
    }
    return usage;
  }

  private parseArguments(raw: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(raw || "{}");
      return parsed !== null && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
