import OpenAI from "openai";
import { OpenAiChatMessage, OpenAiCompletionsRequest } from "./types";
import {
  ChatExecutor,
  ChatAgentGetResponseOutput,
  ChatMessage,
  ChatExecutorInput,
  TemplateSerializer,
  EventName,
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
    let content = "";
    const toolAcc = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let usage:
      | {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        }
      | undefined;
    let lastChunk: unknown;
    for await (const part of stream) {
      lastChunk = part;
      if (part.usage) {
        usage = part.usage;
      }
      const delta = part.choices[0]?.delta as
        | {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
            tool_calls?: {
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          }
        | undefined;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        context.eventProducer.emit(EventName.ChatStreamChunk, {
          context,
          modelId: this.modelId,
          modelProvider: this.modelProvider,
          chunk: { type: "text", text: delta.content },
        });
      }
      const thinking = delta.reasoning_content || delta.reasoning;
      if (thinking) {
        context.eventProducer.emit(EventName.ChatStreamChunk, {
          context,
          modelId: this.modelId,
          modelProvider: this.modelProvider,
          chunk: { type: "thinking", text: thinking },
        });
      }
      for (const toolCall of delta.tool_calls ?? []) {
        const index =
          toolCall.index ??
          (toolCall.id
            ? ([...toolAcc.entries()].find(
                ([, acc]) => acc.id === toolCall.id,
              )?.[0] ?? toolAcc.size)
            : 0);
        const acc = toolAcc.get(index) ?? { id: "", name: "", arguments: "" };
        if (toolCall.id) acc.id = toolCall.id;
        if (toolCall.function?.name) acc.name ||= toolCall.function.name;
        if (toolCall.function?.arguments) {
          acc.arguments += toolCall.function.arguments;
        }
        toolAcc.set(index, acc);
        context.eventProducer.emit(EventName.ChatStreamChunk, {
          context,
          modelId: this.modelId,
          modelProvider: this.modelProvider,
          chunk: {
            type: "tool_call",
            index,
            id: toolCall.id,
            name: toolCall.function?.name,
            argumentsText: toolCall.function?.arguments,
          },
        });
      }
    }
    context.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      response: lastChunk,
      modelId: this.modelId,
      timeMs: Date.now() - chatExecutorStartMs,
    });
    const responseMessages = this.accumulatedToChatMessages(content, toolAcc);
    return {
      responseMessage: responseMessages[responseMessages.length - 1],
      responseMessages,
      usage: usage && {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
    };
  }

  private accumulatedToChatMessages(
    content: string,
    toolAcc: Map<number, { id: string; name: string; arguments: string }>,
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (content) {
      messages.push({ role: "assistant", content, name: undefined });
    }
    if (toolAcc.size > 0) {
      messages.push({
        role: "tool_call",
        toolCalls: [...toolAcc.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, toolCall]) => ({
            function: {
              name: toolCall.name,
              arguments: this.parseArguments(toolCall.arguments),
            },
            type: "function" as const,
            id: toolCall.id,
          })),
      });
    }
    return messages.length > 0
      ? messages
      : [{ role: "assistant", content, name: undefined }];
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
