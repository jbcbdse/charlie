import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import {
  ChatAgentGetResponseOutput,
  ChatExecutor,
  ChatExecutorInput,
  EventName,
} from "@jbcbdse/charlie-core";
import { MantleMessagesConverter } from "./messages-converter";
import {
  bedrockMantleBaseURL,
  MantleAuthOptions,
  resolveMantleProfile,
  resolveMantleRegion,
} from "./mantle-options";

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
    const blocks: {
      type: string;
      thinking?: string;
      signature?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      data?: string;
      inputJson?: string;
    }[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const event of stream) {
      if (event.type === "message_start") {
        inputTokens = event.message.usage?.input_tokens ?? inputTokens;
      }
      if (event.type === "content_block_start") {
        const block = event.content_block;
        blocks[event.index] = { ...block };
        if (block.type === "tool_use") {
          context.eventProducer.emit(EventName.ChatStreamChunk, {
            context,
            modelId: this.modelId,
            modelProvider: this.modelProvider,
            chunk: {
              type: "tool_call",
              index: event.index,
              id: block.id,
              name: block.name,
            },
          });
        }
      }
      if (event.type === "content_block_delta") {
        const acc = blocks[event.index] ?? { type: "text" };
        const delta = event.delta;
        if (delta.type === "text_delta" && delta.text) {
          acc.text = (acc.text ?? "") + delta.text;
          context.eventProducer.emit(EventName.ChatStreamChunk, {
            context,
            modelId: this.modelId,
            modelProvider: this.modelProvider,
            chunk: { type: "text", text: delta.text },
          });
        }
        if (delta.type === "thinking_delta" && delta.thinking) {
          acc.thinking = (acc.thinking ?? "") + delta.thinking;
          context.eventProducer.emit(EventName.ChatStreamChunk, {
            context,
            modelId: this.modelId,
            modelProvider: this.modelProvider,
            chunk: { type: "thinking", text: delta.thinking },
          });
        }
        if (delta.type === "signature_delta" && delta.signature) {
          acc.signature = delta.signature;
        }
        if (delta.type === "input_json_delta" && delta.partial_json) {
          acc.inputJson = (acc.inputJson ?? "") + delta.partial_json;
          context.eventProducer.emit(EventName.ChatStreamChunk, {
            context,
            modelId: this.modelId,
            modelProvider: this.modelProvider,
            chunk: {
              type: "tool_call",
              index: event.index,
              argumentsText: delta.partial_json,
            },
          });
        }
        blocks[event.index] = acc;
      }
      if (event.type === "message_delta") {
        outputTokens = event.usage?.output_tokens ?? outputTokens;
      }
    }
    const content = blocks.filter(Boolean).map((block) => {
      if (block.inputJson) {
        try {
          block.input = JSON.parse(block.inputJson);
        } catch {
          block.input = {};
        }
      }
      return block;
    });
    context.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      response: { content, usage: { inputTokens, outputTokens } },
      modelId: this.modelId,
      timeMs: Date.now() - startMs,
    });
    const responseMessages = this.messageConverter.fromResponse(content);
    const responseMessage = [...responseMessages]
      .reverse()
      .find((m) => m.role !== "reasoning") ??
      responseMessages[responseMessages.length - 1] ?? {
        role: "assistant" as const,
        content: "",
      };
    return {
      responseMessage,
      responseMessages:
        responseMessages.length > 0
          ? responseMessages
          : [{ role: "assistant", content: "" }],
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };
  }
}
