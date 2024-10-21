import { ChatExecutor } from "../core";
import { ChatAgentGetResponseOutput, ChatExecutorInput } from "../core/types";
import {
  GenerateContentRequest,
  GenerativeModel,
  GoogleGenerativeAI,
} from "@google/generative-ai";
import { ToolConverter } from "./tool-converter";
import { MessageConverter } from "./message-converter";
import { EventName, eventProducer } from "../core/event-producer";
import { getCurrentTime } from "../core/get-current-time";

export class GeminiExecutor implements ChatExecutor {
  public modelId: string;
  public modelProvider = "google";
  private toolConverter: ToolConverter;
  private messageConverter: MessageConverter;
  private model: GenerativeModel;
  constructor(options: {
    modelId: string;
    apiKey: string;
    messageConverter?: MessageConverter;
    toolConverter?: ToolConverter;
  }) {
    const genAi = new GoogleGenerativeAI(options.apiKey);
    this.modelId = options.modelId;
    this.model = genAi.getGenerativeModel({ model: options.modelId });
    this.messageConverter = options.messageConverter || new MessageConverter();
    this.toolConverter = options.toolConverter || new ToolConverter();
  }
  public async execute(
    input: ChatExecutorInput,
  ): Promise<ChatAgentGetResponseOutput> {
    const { context, messages, systemPrompt, tools } = input;
    const req: GenerateContentRequest = {
      contents: this.messageConverter.toContentObjects(messages),
      tools: tools ? await this.toolConverter.toGeminiTools(tools) : [],
      systemInstruction: systemPrompt,
    };
    const startMs = getCurrentTime();
    eventProducer.emit(EventName.ChatRawRequest, {
      context,
      modelId: this.modelId,
      modelProvider: this.modelProvider,
      request: req,
    });
    const response = await this.model.generateContent(req);
    eventProducer.emit(EventName.ChatRawResponse, {
      context,
      modelId: this.modelId,
      modelProvider: this.modelProvider,
      response,
      timeMs: getCurrentTime() - startMs,
    });
    const responseMessages = this.messageConverter.responseContentChatMessages(
      response.response.candidates![0].content,
    );
    return {
      responseMessage: responseMessages.at(-1)!,
      responseMessages,
      usage: response.response.usageMetadata && {
        inputTokens: response.response.usageMetadata.promptTokenCount,
        outputTokens: response.response.usageMetadata.candidatesTokenCount,
        totalTokens: response.response.usageMetadata.totalTokenCount,
      },
    };
  }
}
