import {
  ChatExecutor,
  ChatExecutorInput,
  EventName,
  ChatAgentGetResponseOutput,
  CharlieStreamConsumer,
  CharlieStreamPart,
} from "@jbcbdse/charlie-core";
import {
  GenerateContentRequest,
  FunctionCallingMode,
  GenerativeModel,
  GoogleGenerativeAI,
} from "@google/generative-ai";
import { ToolConverter } from "./tool-converter";
import { MessageConverter } from "./message-converter";

export class GeminiExecutor implements ChatExecutor {
  public modelProvider: string;
  public modelId: string;
  private toolConverter: ToolConverter;
  private messageConverter: MessageConverter;
  private model: GenerativeModel;
  constructor(options: {
    modelProvider?: string;
    modelId: string;
    apiKey: string;
    messageConverter?: MessageConverter;
    toolConverter?: ToolConverter;
  }) {
    const genAi = new GoogleGenerativeAI(options.apiKey);
    this.modelProvider = options.modelProvider ?? "google";
    this.modelId = options.modelId;
    this.model = genAi.getGenerativeModel({ model: options.modelId });
    this.messageConverter = options.messageConverter || new MessageConverter();
    this.toolConverter = options.toolConverter || new ToolConverter();
  }
  public async execute(
    input: ChatExecutorInput,
  ): Promise<ChatAgentGetResponseOutput> {
    const { context, messages, tools, toolChoice } = input;
    const req: GenerateContentRequest = {
      contents: this.messageConverter.toContentObjects(messages),
      tools: tools ? await this.toolConverter.toGeminiTools(tools) : [],
      systemInstruction: context.systemPrompt,
      ...(toolChoice && tools?.length
        ? {
            toolConfig: {
              functionCallingConfig: {
                mode: FunctionCallingMode.ANY,
                ...(toolChoice.type === "tool"
                  ? { allowedFunctionNames: [toolChoice.name] }
                  : {}),
              },
            },
          }
        : {}),
    };
    const startMs = Date.now();
    context.eventProducer.emit(EventName.ChatRawRequest, {
      context,
      modelId: this.modelId,
      request: req,
    });
    const streamed = await this.model.generateContentStream(req);
    let aggregated: unknown;
    const result = await new CharlieStreamConsumer(context, this).consume(
      this.toCharlieStream(streamed, (response) => {
        aggregated = response;
      }),
    );
    context.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      modelId: this.modelId,
      response: aggregated,
      timeMs: Date.now() - startMs,
    });
    return result;
  }

  private async *toCharlieStream(
    streamed: {
      stream: AsyncIterable<unknown>;
      response: Promise<unknown>;
    },
    onAggregated: (response: unknown) => void,
  ): AsyncGenerator<CharlieStreamPart> {
    let toolIndex = 0;
    for await (const raw of streamed.stream) {
      const chunk = raw as {
        candidates?: { content?: { parts?: unknown[] } }[];
      };
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts as {
        thought?: boolean;
        text?: string;
        functionCall?: { name: string; args?: Record<string, unknown> };
      }[]) {
        if (part.thought && part.text) {
          yield { type: "thinking", text: part.text };
          continue;
        }
        if (part.text) {
          yield { type: "text", text: part.text };
        }
        if (part.functionCall) {
          yield {
            type: "tool_call",
            index: toolIndex++,
            name: part.functionCall.name,
            argumentsText: JSON.stringify(part.functionCall.args ?? {}),
          };
        }
      }
    }
    const aggregated = (await streamed.response) as {
      usageMetadata?: {
        promptTokenCount?: number;
        cachedContentTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    onAggregated(aggregated);
    if (aggregated.usageMetadata) {
      yield {
        type: "usage",
        inputTokens:
          (aggregated.usageMetadata.promptTokenCount || 0) +
          (aggregated.usageMetadata.cachedContentTokenCount || 0),
        outputTokens: aggregated.usageMetadata.candidatesTokenCount || 0,
        totalTokens: aggregated.usageMetadata.totalTokenCount || 0,
        reasoningTokens: aggregated.usageMetadata.thoughtsTokenCount,
      };
    }
  }
}
