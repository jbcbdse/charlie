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
    const data = await this.client.messages.create(request);
    context.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      response: data,
      modelId: this.modelId,
      timeMs: Date.now() - startMs,
    });
    const responseMessages = this.messageConverter.fromResponse(data.content);
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
      usage: data.usage && {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  }
}
