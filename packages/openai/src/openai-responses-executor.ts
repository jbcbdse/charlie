import OpenAI from "openai";
import {
  ChatExecutor,
  ChatAgentGetResponseOutput,
  ChatMessage,
  ChatExecutorInput,
  EventName,
  StreamChunk,
} from "@jbcbdse/charlie-core";
import { OpenAiChatExecutorOptions } from "./openai-chat-executor";

export type OpenAiResponsesExecutorOptions = OpenAiChatExecutorOptions & {
  maxOutputTokens?: number;
};

type ResponseInputItem = OpenAI.Responses.ResponseInputItem;
type ResponseOutputItem = OpenAI.Responses.ResponseOutputItem;

export class OpenAiResponsesExecutor implements ChatExecutor {
  private openAiClient: OpenAI;
  public modelProvider: string;
  public modelId: string;
  constructor(private options: OpenAiResponsesExecutorOptions) {
    this.options.modelId ??= "gpt-5.4";
    this.modelProvider = options.modelProvider ?? "openai";
    this.modelId = this.options.modelId;
    this.openAiClient =
      options.openAiClient ??
      new OpenAI({
        baseURL: options.baseURL || "https://api.openai.com/v1/",
        apiKey: options.apiKey || "",
        dangerouslyAllowBrowser: options.dangerouslyAllowBrowser || false,
        maxRetries: options.maxRetries || undefined,
        timeout: options.timeout || undefined,
      });
  }

  public async execute({
    messages,
    tools,
    context,
  }: ChatExecutorInput): Promise<ChatAgentGetResponseOutput> {
    const request: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: this.options.modelId,
      input: this.toInputItems(messages),
      instructions: context.systemPrompt,
      store: false,
      include: ["reasoning.encrypted_content"],
      stream: true,
      tools:
        tools &&
        tools.map((tool) => ({
          type: "function" as const,
          name: tool.name,
          description: tool.description,
          parameters: tool.jsonSchema,
          strict: false,
        })),
      max_output_tokens: this.options.maxOutputTokens,
    };
    const startMs = Date.now();
    context.eventProducer.emit(EventName.ChatRawRequest, {
      context,
      request,
      modelId: this.modelId,
    });
    const stream = await this.openAiClient.responses.create(request);
    let completed: OpenAI.Responses.Response | undefined;
    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta) {
        this.emitChunk(context, { type: "text", text: event.delta });
      }
      if (
        (event.type === "response.reasoning_text.delta" ||
          event.type === "response.reasoning_summary_text.delta") &&
        event.delta
      ) {
        this.emitChunk(context, { type: "thinking", text: event.delta });
      }
      if (
        event.type === "response.output_item.added" &&
        event.item.type === "function_call"
      ) {
        this.emitChunk(context, {
          type: "tool_call",
          index: event.output_index,
          id: event.item.call_id,
          name: event.item.name,
        });
      }
      if (
        event.type === "response.function_call_arguments.delta" &&
        event.delta
      ) {
        this.emitChunk(context, {
          type: "tool_call",
          index: event.output_index,
          argumentsText: event.delta,
        });
      }
      if (event.type === "error") {
        throw new Error(
          "message" in event && typeof event.message === "string"
            ? event.message
            : "Responses stream error",
        );
      }
      if (event.type === "response.failed") {
        throw new Error(
          event.response.error?.message || "Responses request failed",
        );
      }
      if (event.type === "response.incomplete") {
        throw new Error(
          event.response.incomplete_details?.reason ||
            "Responses request incomplete",
        );
      }
      if (event.type === "response.completed") {
        completed = event.response;
      }
    }
    if (!completed) {
      throw new Error("Responses stream ended without a completed response");
    }
    context.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      response: completed,
      modelId: this.modelId,
      timeMs: Date.now() - startMs,
    });
    const responseMessages = this.outputToChatMessages(completed?.output ?? []);
    const responseMessage = [...responseMessages]
      .reverse()
      .find((m) => m.role !== "reasoning") ??
      responseMessages[responseMessages.length - 1] ?? {
        role: "assistant" as const,
        content: completed?.output_text || "",
      };
    return {
      responseMessage,
      responseMessages:
        responseMessages.length > 0
          ? responseMessages
          : [{ role: "assistant", content: completed?.output_text || "" }],
      usage: completed?.usage && {
        inputTokens: completed.usage.input_tokens,
        outputTokens: completed.usage.output_tokens,
        totalTokens: completed.usage.total_tokens,
      },
    };
  }

  private emitChunk(
    context: ChatExecutorInput["context"],
    chunk: StreamChunk,
  ): void {
    context.eventProducer.emit(EventName.ChatStreamChunk, {
      context,
      modelId: this.modelId,
      modelProvider: this.modelProvider,
      chunk,
    });
  }

  private toInputItems(messages: ChatMessage[]): ResponseInputItem[] {
    const items: ResponseInputItem[] = [];
    for (const msg of messages) {
      if (msg.role === "user") {
        items.push({ role: "user", content: msg.content });
        continue;
      }
      if (msg.role === "system") {
        items.push({ role: "system", content: msg.content });
        continue;
      }
      if (msg.role === "assistant") {
        items.push({ role: "assistant", content: msg.content });
        continue;
      }
      if (msg.role === "reasoning") {
        if (!msg.encryptedContent || !msg.id) continue;
        items.push({
          type: "reasoning",
          id: msg.id,
          summary: [],
          encrypted_content: msg.encryptedContent,
        });
        continue;
      }
      if (msg.role === "tool_call") {
        for (const toolCall of msg.toolCalls) {
          items.push({
            type: "function_call",
            call_id: toolCall.id,
            name: toolCall.function.name,
            arguments: JSON.stringify(toolCall.function.arguments),
          });
        }
        continue;
      }
      if (msg.role === "tool") {
        items.push({
          type: "function_call_output",
          call_id: msg.toolCallId,
          output: msg.content,
        });
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`Unknown message role: ${(msg as any)?.role}`);
    }
    return items;
  }

  private outputToChatMessages(output: ResponseOutputItem[]): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const pendingToolCalls: ChatMessage & { role: "tool_call" } = {
      role: "tool_call",
      toolCalls: [],
    };
    const flushToolCalls = () => {
      if (pendingToolCalls.toolCalls.length > 0) {
        messages.push({
          role: "tool_call",
          toolCalls: pendingToolCalls.toolCalls,
        });
        pendingToolCalls.toolCalls = [];
      }
    };
    for (const item of output) {
      if (item.type === "reasoning") {
        flushToolCalls();
        messages.push({
          role: "reasoning",
          id: item.id,
          encryptedContent: item.encrypted_content ?? undefined,
        });
        continue;
      }
      if (item.type === "message") {
        flushToolCalls();
        const text = item.content
          .map((part) =>
            part.type === "output_text"
              ? part.text
              : part.type === "refusal"
                ? part.refusal
                : "",
          )
          .join("");
        messages.push({ role: "assistant", content: text });
        continue;
      }
      if (item.type === "function_call") {
        pendingToolCalls.toolCalls.push({
          id: item.call_id,
          type: "function",
          function: {
            name: item.name,
            arguments: this.parseArguments(item.arguments),
          },
        });
        continue;
      }
    }
    flushToolCalls();
    return messages;
  }

  private parseArguments(raw: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed !== null && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
