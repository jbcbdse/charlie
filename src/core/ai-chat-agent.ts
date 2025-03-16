import {
  ChatExecutor,
  ChatAgentGetResponseInput,
  ChatAgentGetResponseOutput,
  ChatMessageTransformer,
  ChatAgent,
  MessageToolCall,
  ChatAgentContext,
  MessageTool,
  UsageMetadata,
} from "./types";
import { ToolExecutor } from "./tool-executor";
import { EventName, eventProducer, EventProducer } from "./event-producer";
import { newRunId } from "./new-run-id";
import { BaseTool } from "./base-tool";
import { TemplateSerializer } from "./template-serializer";
import { getCurrentTime } from "./get-current-time";

export class AiChatAgent implements ChatAgent {
  private chatExecutor: ChatExecutor;
  private toolExecutor: ToolExecutor;
  private preToolCallTransformers: ChatMessageTransformer[] = [];
  private postToolCallTransformers: ChatMessageTransformer[] = [];
  private postRunTransformers: ChatMessageTransformer[] = [];
  private eventProducer: EventProducer;
  private systemPromptTemplate?: string;
  private templateSerializer: TemplateSerializer;
  constructor(options: {
    chatExecutor: ChatExecutor;
    toolExecutor?: ToolExecutor;
    systemPromptTemplate?: string;
    templateSerializer?: TemplateSerializer;
    preToolCallTransformers?: ChatMessageTransformer[];
    postToolCallTransformers?: ChatMessageTransformer[];
    postRunTransformers?: ChatMessageTransformer[];
  }) {
    this.chatExecutor = options.chatExecutor;
    this.toolExecutor = options.toolExecutor || new ToolExecutor();
    this.preToolCallTransformers = options.preToolCallTransformers || [];
    this.postToolCallTransformers = options.postToolCallTransformers || [];
    this.postRunTransformers = options.postRunTransformers || [];
    this.eventProducer = eventProducer;
    this.systemPromptTemplate = options.systemPromptTemplate;
    this.templateSerializer =
      options.templateSerializer || new TemplateSerializer();
  }
  public async getResponse({
    messages,
    tools,
    meta = {},
  }: ChatAgentGetResponseInput): Promise<ChatAgentGetResponseOutput> {
    const systemPrompt = this.systemPromptTemplate
      ? this.templateSerializer.serialize(this.systemPromptTemplate, meta)
      : undefined;
    let doLoop = true;
    let responseMessages: ChatAgentGetResponseOutput["responseMessages"] = [];
    const context: ChatAgentContext = {
      runId: newRunId(),
      modelId: this.chatExecutor.modelId,
      messages,
      meta,
    };
    context.runId = newRunId();
    context.modelId = this.chatExecutor.modelId;
    context.messages = messages;
    const chatStartMs = getCurrentTime();
    this.eventProducer.emit(EventName.ChatStart, {
      context,
      messages,
      systemPrompt,
      modelId: this.chatExecutor.modelId,
      modelProivder: this.chatExecutor.modelProvider,
      startTime: chatStartMs,
    });
    const usage: UsageMetadata = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    do {
      const chatExecutorStartMs = getCurrentTime();
      this.eventProducer.emit(EventName.ChatExecutorStart, {
        context,
        messages,
        modelId: this.chatExecutor.modelId,
        modelProvider: this.chatExecutor.modelProvider,
        startTime: chatExecutorStartMs,
      });
      const response = await this.chatExecutor.execute({
        messages,
        tools,
        systemPrompt,
        context,
      });
      let newResponseMessages = response.responseMessages;
      for (const transformer of this.preToolCallTransformers) {
        newResponseMessages = await transformer.transform(newResponseMessages);
      }
      responseMessages.push(...newResponseMessages);
      this.eventProducer.emit(EventName.ChatExecutorEnd, {
        context,
        messages: messages,
        responseMessages: newResponseMessages,
        modelId: this.chatExecutor.modelId,
        modelProvider: this.chatExecutor.modelProvider,
        startTime: chatExecutorStartMs,
        timeMs: getCurrentTime() - chatExecutorStartMs,
        usage: response.usage,
      });
      usage.inputTokens += response.usage?.inputTokens || 0;
      usage.outputTokens += response.usage?.outputTokens || 0;
      usage.totalTokens += response.usage?.totalTokens || 0;
      const toolCalls = newResponseMessages.filter(
        (m) => m.role === "tool_call",
      );
      if (tools && toolCalls.length > 0) {
        const toolResponses = await this.executeToolCalls(
          toolCalls,
          tools,
          context,
        );
        responseMessages.push(...toolResponses);
        let newMessages = [...newResponseMessages, ...toolResponses];
        for (const transformer of this.postToolCallTransformers) {
          newMessages = await transformer.transform(newMessages);
        }
        messages = [...messages, ...newMessages];
      } else {
        doLoop = false;
      }
    } while (doLoop);
    for (const transformer of this.postRunTransformers) {
      responseMessages = await transformer.transform(responseMessages);
    }
    const response = {
      responseMessage: responseMessages[responseMessages.length - 1],
      responseMessages,
      usage,
    };
    this.eventProducer.emit(EventName.ChatEnd, {
      context,
      messages: response.responseMessages,
      modelId: this.chatExecutor.modelId,
      modelProvider: this.chatExecutor.modelProvider,
      startTime: chatStartMs,
      timeMs: getCurrentTime() - chatStartMs,
      usage,
    });
    return response;
  }

  private async executeToolCalls(
    toolCalls: MessageToolCall[],
    tools: BaseTool[],
    context: ChatAgentContext,
  ): Promise<MessageTool[]> {
    const toolStartMs = getCurrentTime();
    this.eventProducer.emit(EventName.ToolsStart, {
      context,
      toolCalls,
      startTime: toolStartMs,
    });
    const toolMessages = await Promise.all(
      toolCalls.map((toolCall) =>
        this.toolExecutor.execute(toolCall, tools, context),
      ),
    ).then((results) => results.flat());
    this.eventProducer.emit(EventName.ToolsEnd, {
      context,
      toolMessages,
      startTime: toolStartMs,
      timeMs: getCurrentTime() - toolStartMs,
    });
    return toolMessages;
  }
}
