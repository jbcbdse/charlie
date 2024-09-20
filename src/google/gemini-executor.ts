import { ChatExecutor } from "../core";
import {
  ChatAgentGetResponseOutput,
  ChatExecutorInput,
  ChatMessage,
} from "../core/types";
import {
  GenerateContentRequest,
  GenerativeModel,
  GoogleGenerativeAI,
} from "@google/generative-ai";
import { ToolConverter } from "./tool-converter";
import { MessageConverter } from "./message-converter";
import { EventName, eventProducer } from "../core/event-producer";

export class GeminiExecutor implements ChatExecutor {
  public modelId: string;
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
    const startMs = Date.now();
    eventProducer.emit(EventName.ChatRawRequest, {
      context,
      modelId: this.modelId,
      request: req,
    });
    const response = await this.model.generateContent(req);
    eventProducer.emit(EventName.ChatRawResponse, {
      context,
      modelId: this.modelId,
      response,
      timeMs: Date.now() - startMs,
    });
    const responseMessages = this.messageConverter.responseContentChatMessages(
      response.response.candidates![0].content,
    );
    return {
      responseMessage: responseMessages.at(-1)!,
      responseMessages,
    };
  }
}
