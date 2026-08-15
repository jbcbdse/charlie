import {
  ChatExecutor,
  ChatExecutorInput,
  EventName,
  ChatAgentGetResponseOutput,
} from "@jbcbdse/charlie-core";
import {
  GenerateContentRequest,
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
    const { context, messages, tools } = input;
    const req: GenerateContentRequest = {
      contents: this.messageConverter.toContentObjects(messages),
      tools: tools ? await this.toolConverter.toGeminiTools(tools) : [],
      systemInstruction: context.systemPrompt,
    };
    const startMs = Date.now();
    context.eventProducer.emit(EventName.ChatRawRequest, {
      context,
      modelId: this.modelId,
      request: req,
    });
    const streamed = await this.model.generateContentStream(req);
    let toolIndex = 0;
    for await (const chunk of streamed.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if ("thought" in part && part.thought && part.text) {
          context.eventProducer.emit(EventName.ChatStreamChunk, {
            context,
            modelId: this.modelId,
            modelProvider: this.modelProvider,
            chunk: { type: "thinking", text: part.text },
          });
          continue;
        }
        if (part.text) {
          context.eventProducer.emit(EventName.ChatStreamChunk, {
            context,
            modelId: this.modelId,
            modelProvider: this.modelProvider,
            chunk: { type: "text", text: part.text },
          });
        }
        if (part.functionCall) {
          context.eventProducer.emit(EventName.ChatStreamChunk, {
            context,
            modelId: this.modelId,
            modelProvider: this.modelProvider,
            chunk: {
              type: "tool_call",
              index: toolIndex++,
              name: part.functionCall.name,
              argumentsText: JSON.stringify(part.functionCall.args ?? {}),
            },
          });
        }
      }
    }
    const aggregated = await streamed.response;
    context.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      modelId: this.modelId,
      response: aggregated,
      timeMs: Date.now() - startMs,
    });
    const responseMessages = this.messageConverter.responseContentChatMessages(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      aggregated.candidates![0].content,
    );
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      responseMessage: responseMessages.at(-1)!,
      responseMessages,
      usage: aggregated.usageMetadata && {
        inputTokens:
          (aggregated.usageMetadata.promptTokenCount || 0) +
          (aggregated.usageMetadata.cachedContentTokenCount || 0),
        outputTokens: aggregated.usageMetadata.candidatesTokenCount,
        totalTokens: aggregated.usageMetadata.totalTokenCount,
      },
    };
  }
}
