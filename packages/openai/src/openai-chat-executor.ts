import OpenAI from "openai";
import { OpenAiChatMessage, OpenAiCompletionsRequest } from "./types";
import {
  ChatExecutor,
  ChatAgentGetResponseOutput,
  ChatMessage,
  ChatExecutorInput,
  TemplateSerializer,
  EventName,
  CharlieStreamConsumer,
  CharlieStreamPart,
  ToolChoice,
} from "@jbcbdse/charlie-core";

export interface OpenAiChatExecutorOptions {
  modelProvider?: string;
  modelId: string;
  promptSerializer?: TemplateSerializer;
  openAiClient?: OpenAI;
  apiKey?: string | (() => Promise<string>);
  baseURL?: string;
  dangerouslyAllowBrowser?: boolean;
  maxRetries?: number;
  timeout?: number;
}
export class OpenAiChatExecutor implements ChatExecutor {
  private openAiClient: OpenAI;
  public modelProvider: string;
  public modelId: string;
  constructor(private options: OpenAiChatExecutorOptions) {
    this.options.modelId ??= "o4-mini";
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
    const openAiMessages = this.toOpenAiMessages(messages);
    if (context.systemPrompt) {
      openAiMessages.unshift({
        role: "system",
        content: context.systemPrompt,
      });
    }
    const request: OpenAiCompletionsRequest = {
      model: this.options.modelId,
      messages: openAiMessages,
      tools:
        tools &&
        tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.jsonSchema,
          },
        })),
      tool_choice: tools?.length
        ? this.toOpenAiToolChoice(toolChoice)
        : undefined,
    };
    const chatExecutorStartMs = Date.now();
    context.eventProducer.emit(EventName.ChatRawRequest, {
      context,
      request,
      modelId: this.modelId,
    });
    const stream = await this.openAiClient.chat.completions.create({
      ...request,
      stream: true,
      stream_options: { include_usage: true },
    });
    let lastChunk: unknown;
    const result = await new CharlieStreamConsumer(context, this).consume(
      this.toCharlieStream(stream, (part) => {
        lastChunk = part;
      }),
    );
    context.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      response: lastChunk,
      modelId: this.modelId,
      timeMs: Date.now() - chatExecutorStartMs,
    });
    return result;
  }

  private async *toCharlieStream(
    stream: AsyncIterable<unknown>,
    onPart: (part: unknown) => void,
  ): AsyncGenerator<CharlieStreamPart> {
    const toolIds = new Map<string, number>();
    let nextIndex = 0;
    for await (const raw of stream) {
      onPart(raw);
      const part = raw as {
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
        choices?: {
          delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
            tool_calls?: {
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
      };
      if (part.usage) {
        yield {
          type: "usage",
          inputTokens: part.usage.prompt_tokens,
          outputTokens: part.usage.completion_tokens,
          totalTokens: part.usage.total_tokens,
          reasoningTokens:
            part.usage.completion_tokens_details?.reasoning_tokens,
        };
      }
      const delta = part.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        yield { type: "text", text: delta.content };
      }
      const thinking = delta.reasoning_content || delta.reasoning;
      if (thinking) {
        yield { type: "thinking", text: thinking };
      }
      for (const toolCall of delta.tool_calls ?? []) {
        let index = toolCall.index;
        if (index === undefined && toolCall.id && toolIds.has(toolCall.id)) {
          index = toolIds.get(toolCall.id);
        }
        if (index === undefined) {
          index = toolCall.id ? nextIndex++ : 0;
        }
        if (toolCall.id) toolIds.set(toolCall.id, index);
        yield {
          type: "tool_call",
          index,
          id: toolCall.id,
          name: toolCall.function?.name,
          argumentsText: toolCall.function?.arguments,
        };
      }
    }
  }

  private toOpenAiToolChoice(
    toolChoice?: ToolChoice,
  ): OpenAiCompletionsRequest["tool_choice"] {
    if (!toolChoice) return undefined;
    if (toolChoice.type === "required") return "required";
    return { type: "function", function: { name: toolChoice.name } };
  }

  private toOpenAiMessages(messages: ChatMessage[]): OpenAiChatMessage[] {
    return messages
      .filter((msg) => msg.role !== "reasoning")
      .map((msg) => {
        if (msg.role === "user") {
          return {
            role: "user",
            content: msg.content,
            name: msg.name,
          };
        }
        if (msg.role === "system") {
          return {
            role: "system",
            content: msg.content,
            name: msg.name,
          };
        }
        if (msg.role === "tool_call") {
          return {
            role: "assistant",
            content: "",
            tool_calls: msg.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.function.name,
                arguments: JSON.stringify(toolCall.function.arguments),
              },
            })),
          };
        }
        if (msg.role === "assistant") {
          return {
            role: "assistant",
            content: msg.content,
            name: msg.name,
          };
        }
        if (msg.role === "tool") {
          return {
            role: "tool",
            content: msg.content,
            tool_call_id: msg.toolCallId,
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        throw new Error(`Unknown message role: ${(msg as any)?.role}`);
      });
  }
}
