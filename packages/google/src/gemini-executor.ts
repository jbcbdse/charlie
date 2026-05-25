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
    const response = await this.model.generateContent(req);
    context.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      modelId: this.modelId,
      response,
      timeMs: Date.now() - startMs,
    });
    const responseMessages = this.messageConverter.responseContentChatMessages(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      response.response.candidates![0].content,
    );
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      responseMessage: responseMessages.at(-1)!,
      responseMessages,
      usage: response.response.usageMetadata && {
        inputTokens:
          (response.response.usageMetadata.promptTokenCount || 0) +
          (response.response.usageMetadata.cachedContentTokenCount || 0),
        outputTokens: response.response.usageMetadata.candidatesTokenCount,
        totalTokens: response.response.usageMetadata.totalTokenCount,
      },
    };
  }
}
