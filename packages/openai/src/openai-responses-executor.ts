import OpenAI from "openai";
import {
  ChatExecutor,
  ChatAgentGetResponseOutput,
  ChatMessage,
  ChatExecutorInput,
  EventName,
  CharlieStreamConsumer,
  CharlieStreamPart,
  ToolChoice,
} from "@jbcbdse/charlie-core";
import { OpenAiChatExecutorOptions } from "./openai-chat-executor";

export type OpenAiResponsesExecutorOptions = OpenAiChatExecutorOptions & {
  maxOutputTokens?: number;
};

type ResponseInputItem = OpenAI.Responses.ResponseInputItem;

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
    toolChoice,
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
      tool_choice: tools?.length
        ? this.toResponsesToolChoice(toolChoice)
        : undefined,
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
    const result = await new CharlieStreamConsumer(context, this).consume(
      this.toCharlieStream(stream, (response) => {
        completed = response;
      }),
    );
    if (!completed) {
      throw new Error("Responses stream ended without a completed response");
    }
    context.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      response: completed,
      modelId: this.modelId,
      timeMs: Date.now() - startMs,
    });
    return result;
  }

  private toResponsesToolChoice(
    toolChoice?: ToolChoice,
  ): OpenAI.Responses.ResponseCreateParamsStreaming["tool_choice"] {
    if (!toolChoice) return undefined;
    if (toolChoice.type === "required") return "required";
    return { type: "function", name: toolChoice.name };
  }

  private async *toCharlieStream(
    stream: AsyncIterable<unknown>,
    onCompleted: (response: OpenAI.Responses.Response) => void,
  ): AsyncGenerator<CharlieStreamPart> {
    let sawToolCall = false;
    for await (const raw of stream) {
      const part = raw as { type: string; [key: string]: unknown };
      if (part.type === "response.output_text.delta" && part.delta) {
        yield { type: "text", text: String(part.delta) };
      }
      if (
        (part.type === "response.reasoning_text.delta" ||
          part.type === "response.reasoning_summary_text.delta") &&
        part.delta
      ) {
        yield { type: "thinking", text: String(part.delta) };
      }
      if (
        part.type === "response.output_item.added" &&
        part.item &&
        typeof part.item === "object" &&
        "type" in part.item &&
        part.item.type === "function_call"
      ) {
        const item = part.item as { call_id?: string; name?: string };
        sawToolCall = true;
        yield {
          type: "tool_call",
          index: Number(part.output_index ?? 0),
          id: item.call_id,
          name: item.name,
        };
      }
      if (
        part.type === "response.function_call_arguments.delta" &&
        part.delta
      ) {
        sawToolCall = true;
        yield {
          type: "tool_call",
          index: Number(part.output_index ?? 0),
          argumentsText: String(part.delta),
        };
      }
      if (part.type === "error") {
        yield {
          type: "error",
          error: new Error(
            typeof part.message === "string"
              ? part.message
              : "Responses stream error",
          ),
        };
      }
      if (part.type === "response.failed") {
        const response = part.response as
          | { error?: { message?: string } }
          | undefined;
        yield {
          type: "error",
          error: new Error(
            response?.error?.message || "Responses request failed",
          ),
        };
      }
      if (part.type === "response.incomplete") {
        const response = part.response as
          | { incomplete_details?: { reason?: string } }
          | undefined;
        yield {
          type: "error",
          error: new Error(
            response?.incomplete_details?.reason ||
              "Responses request incomplete",
          ),
        };
      }
      if (part.type === "response.completed") {
        const response = part.response as OpenAI.Responses.Response;
        onCompleted(response);
        if (response.usage) {
          yield {
            type: "usage",
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
            reasoningTokens:
              response.usage.output_tokens_details?.reasoning_tokens,
          };
        }
        let toolIndex = 0;
        for (const item of response.output ?? []) {
          if (item.type === "reasoning") {
            yield {
              type: "reasoning",
              id: item.id,
              encryptedContent: item.encrypted_content ?? undefined,
            };
          }
          if (!sawToolCall && item.type === "function_call") {
            yield {
              type: "tool_call",
              index: toolIndex++,
              id: item.call_id,
              name: item.name,
              argumentsText: item.arguments,
            };
          }
        }
      }
    }
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
}
