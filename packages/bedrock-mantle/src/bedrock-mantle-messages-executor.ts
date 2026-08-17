import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import {
  ChatAgentGetResponseOutput,
  ChatExecutor,
  ChatExecutorInput,
  EventName,
  CharlieStreamConsumer,
  CharlieStreamPart,
  ToolChoice,
} from "@jbcbdse/charlie-core";
import { MantleMessagesConverter } from "./messages-converter";
import {
  bedrockMantleBaseURL,
  MantleAuthOptions,
  resolveMantleProfile,
  resolveMantleRegion,
} from "./mantle-options";

type AnthropicBlock<T extends ContentBlock["type"]> = Extract<
  ContentBlock,
  { type: T }
>;

/** Anthropic Messages {@link ContentBlock} as assembled from stream events. */
interface AnthropicContentBlock {
  type: ContentBlock["type"];
  text?: AnthropicBlock<"text">["text"];
  thinking?: AnthropicBlock<"thinking">["thinking"];
  signature?: AnthropicBlock<"thinking">["signature"];
  id?: AnthropicBlock<"tool_use">["id"];
  name?: AnthropicBlock<"tool_use">["name"];
  input?: AnthropicBlock<"tool_use">["input"];
  data?: AnthropicBlock<"redacted_thinking">["data"];
  inputJson?: string;
}

export type BedrockMantleMessagesExecutorOptions = MantleAuthOptions & {
  modelProvider?: string;
  modelId?: string;
  maxTokens?: number;
  baseURL?: string;
  anthropicClient?: AnthropicBedrockMantle;
  messageConverter?: MantleMessagesConverter;
  thinking?: { type: "enabled"; budget_tokens: number } | { type: "adaptive" };
};

export class BedrockMantleMessagesExecutor implements ChatExecutor {
  public modelProvider: string;
  public modelId: string;
  private maxTokens: number;
  private thinking: BedrockMantleMessagesExecutorOptions["thinking"];
  private client: AnthropicBedrockMantle;
  private messageConverter: MantleMessagesConverter;

  constructor(options: BedrockMantleMessagesExecutorOptions = {}) {
    this.modelProvider = options.modelProvider ?? "aws-bedrock-mantle";
    this.modelId = options.modelId ?? "anthropic.claude-haiku-4-5";
    this.maxTokens = options.maxTokens ?? 8192;
    this.thinking = options.thinking;
    this.messageConverter =
      options.messageConverter ?? new MantleMessagesConverter();
    const apiKey =
      typeof options.apiKey === "string"
        ? options.apiKey
        : process.env.AWS_BEARER_TOKEN_BEDROCK || undefined;
    this.client =
      options.anthropicClient ??
      new AnthropicBedrockMantle({
        awsRegion: resolveMantleRegion(options),
        apiKey,
        awsProfile: apiKey ? undefined : resolveMantleProfile(options),
        baseURL:
          options.baseURL ?? bedrockMantleBaseURL("anthropic", options.region),
      });
  }

  public async execute({
    messages,
    tools,
    context,
    toolChoice,
  }: ChatExecutorInput): Promise<ChatAgentGetResponseOutput> {
    const request = {
      model: this.modelId,
      max_tokens: this.maxTokens,
      system: context.systemPrompt,
      messages: this.messageConverter.toMessages(messages),
      thinking: this.thinking,
      tools: tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: {
          ...tool.jsonSchema,
          type: "object" as const,
        },
      })),
      tool_choice: tools?.length
        ? this.toAnthropicToolChoice(toolChoice)
        : undefined,
    };
    const startMs = Date.now();
    context.eventProducer.emit(EventName.ChatRawRequest, {
      context,
      request,
      modelId: this.modelId,
    });
    const stream = await this.client.messages.create({
      ...request,
      stream: true,
    });
    const result = await new CharlieStreamConsumer(context, this).consume(
      this.toCharlieStream(stream),
    );
    context.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      response: { usage: result.usage },
      modelId: this.modelId,
      timeMs: Date.now() - startMs,
    });
    return result;
  }

  private toAnthropicToolChoice(
    toolChoice?: ToolChoice,
  ): { type: "any" } | { type: "tool"; name: string } | undefined {
    if (!toolChoice) return undefined;
    if (this.thinking) {
      throw new Error(
        "toolChoice cannot be used with Anthropic extended thinking",
      );
    }
    if (toolChoice.type === "required") return { type: "any" };
    return { type: "tool", name: toolChoice.name };
  }

  private async *toCharlieStream(
    stream: AsyncIterable<unknown>,
  ): AsyncGenerator<CharlieStreamPart> {
    const thinking: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens: number | undefined;
    for await (const raw of stream) {
      const part = raw as {
        type: string;
        index?: number;
        message?: { usage?: { input_tokens?: number } };
        content_block?: AnthropicContentBlock;
        delta?: {
          type: string;
          text?: string;
          thinking?: string;
          signature?: string;
          partial_json?: string;
        };
        usage?: {
          output_tokens?: number;
          output_tokens_details?: { thinking_tokens?: number | null };
        };
      };
      if (part.type === "message_start") {
        inputTokens = part.message?.usage?.input_tokens ?? inputTokens;
      }
      if (part.type === "content_block_start") {
        const block = part.content_block;
        if (block?.type === "tool_use") {
          yield {
            type: "tool_call",
            index: part.index ?? 0,
            id: block.id,
            name: block.name,
          };
        }
        if (block?.type === "redacted_thinking" && block.data) {
          yield { type: "reasoning", signature: block.data };
        }
      }
      if (part.type === "content_block_delta") {
        const index = part.index ?? 0;
        const delta = part.delta;
        if (delta?.type === "text_delta" && delta.text) {
          yield { type: "text", text: delta.text };
        }
        if (delta?.type === "thinking_delta" && delta.thinking) {
          thinking[index] = (thinking[index] ?? "") + delta.thinking;
          yield { type: "thinking", text: delta.thinking };
        }
        if (delta?.type === "signature_delta" && delta.signature) {
          yield {
            type: "reasoning",
            content: thinking[index],
            signature: delta.signature,
          };
        }
        if (delta?.type === "input_json_delta" && delta.partial_json) {
          yield {
            type: "tool_call",
            index,
            argumentsText: delta.partial_json,
          };
        }
      }
      if (part.type === "message_delta") {
        outputTokens = part.usage?.output_tokens ?? outputTokens;
        reasoningTokens =
          part.usage?.output_tokens_details?.thinking_tokens ?? reasoningTokens;
      }
    }
    yield {
      type: "usage",
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      reasoningTokens,
    };
  }
}
