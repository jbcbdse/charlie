import {
  ChatExecutor,
  ChatAgentGetResponseInput,
  ChatAgentGetResponseOutput,
  ChatMessage,
  ChatMessageTransformer,
  ChatAgent,
  MessageToolCall,
  ChatAgentContext,
  MessageTool,
  MessageAssistant,
  ChatRun,
  ToolChoice,
} from "./types";
import { ToolExecutor } from "./tool-executor";
import { EventName, eventProducer, EventProducer } from "./event-producer";
import { newRunId } from "./new-run-id";
import { ITool } from "./base-tool";
import { TemplateSerializer } from "./template-serializer";
import { ChatRunGenerator } from "./chat-run";

export class AiChatAgent implements ChatAgent {
  private chatExecutor: ChatExecutor;
  private toolExecutor: ToolExecutor;
  private preRunTransformers: ChatMessageTransformer[] = [];
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
    preRunTransformers?: ChatMessageTransformer[];
    preToolCallTransformers?: ChatMessageTransformer[];
    postToolCallTransformers?: ChatMessageTransformer[];
    postRunTransformers?: ChatMessageTransformer[];
    eventProducer?: EventProducer;
  }) {
    this.chatExecutor = options.chatExecutor;
    this.toolExecutor = options.toolExecutor || new ToolExecutor();
    this.preRunTransformers = options.preRunTransformers || [];
    this.preToolCallTransformers = options.preToolCallTransformers || [];
    this.postToolCallTransformers = options.postToolCallTransformers || [];
    this.postRunTransformers = options.postRunTransformers || [];
    this.eventProducer = options.eventProducer ?? eventProducer;
    this.systemPromptTemplate = options.systemPromptTemplate;
    this.templateSerializer =
      options.templateSerializer || new TemplateSerializer();
  }
  public getResponse({
    messages,
    tools,
    meta = {},
    mustCallTool,
    requiredToolName,
  }: ChatAgentGetResponseInput): ChatRun {
    const runId = newRunId();
    return new ChatRunGenerator(this.eventProducer, runId, () =>
      this.runLoop({
        messages,
        tools,
        meta,
        mustCallTool,
        requiredToolName,
        runId,
      }),
    ).create();
  }

  private async runLoop({
    messages,
    tools,
    meta,
    mustCallTool,
    requiredToolName,
    runId,
  }: ChatAgentGetResponseInput & {
    runId: string;
  }): Promise<ChatAgentGetResponseOutput> {
    let doLoop = true;
    let responseMessages: ChatAgentGetResponseOutput["responseMessages"] = [];
    const context: ChatAgentContext = {
      runId,
      modelId: this.chatExecutor.modelId,
      messages: [...messages],
      tools: [...(tools ?? [])],
      meta: meta ?? {},
      eventProducer: this.eventProducer,
      systemPromptTemplate: this.systemPromptTemplate,
      systemPrompt: undefined,
      mustCallTool: mustCallTool ?? false,
      requiredToolName,
    };
    const chatStartMs = Date.now();
    for (const transformer of this.preRunTransformers) {
      context.messages = await transformer.transform(context.messages, context);
    }
    let started = false;
    let lastLlmResponseMessages: ChatMessage[] = [];
    do {
      // Synthesize the system prompt from the template and meta on each iteration
      context.systemPrompt = context.systemPromptTemplate
        ? this.templateSerializer.serialize(
            context.systemPromptTemplate,
            context.meta,
          )
        : undefined;
      if (!started) {
        this.eventProducer.emit(EventName.ChatStart, {
          context,
          startTime: chatStartMs,
          messages: context.messages,
          systemPrompt: context.systemPrompt,
          modelId: this.chatExecutor.modelId,
        });
        started = true;
      }
      const chatExecutorStartMs = Date.now();
      this.eventProducer.emit(EventName.ChatExecutorStart, {
        context,
        startTime: chatExecutorStartMs,
        messages: context.messages,
        systemPrompt: context.systemPrompt,
        modelId: this.chatExecutor.modelId,
      });
      const toolChoice = this.resolveToolChoice(context);
      const response = await this.chatExecutor.execute({
        messages: context.messages,
        tools: context.tools.length ? context.tools : undefined,
        context,
        toolChoice,
      });
      if (toolChoice) {
        context.mustCallTool = false;
        context.requiredToolName = undefined;
      }
      let newResponseMessages = response.responseMessages;
      for (const transformer of this.preToolCallTransformers) {
        newResponseMessages = await transformer.transform(
          newResponseMessages,
          context,
        );
      }
      lastLlmResponseMessages = newResponseMessages;
      responseMessages.push(...newResponseMessages);
      this.eventProducer.emit(EventName.ChatExecutorEnd, {
        context,
        messages: newResponseMessages,
        modelProvider: this.chatExecutor.modelProvider,
        modelId: this.chatExecutor.modelId,
        startTime: chatExecutorStartMs,
        timeMs: Date.now() - chatExecutorStartMs,
        responseMessages: newResponseMessages,
        usage: response.usage,
      });
      const toolCalls = newResponseMessages.filter(
        (m) => m.role === "tool_call",
      );
      if (tools && toolCalls.length > 0) {
        const toolResponses = await this.executeToolCalls(
          toolCalls,
          context.tools,
          context,
        );
        responseMessages.push(...toolResponses);
        let newMessages = [...newResponseMessages, ...toolResponses];
        for (const transformer of this.postToolCallTransformers) {
          newMessages = await transformer.transform(newMessages, context);
        }
        const directResponse = toolResponses.find((t) => t.returnDirect);
        if (directResponse) {
          const directMessage: MessageAssistant = {
            role: "assistant",
            content: directResponse.content,
          };
          responseMessages.push(directMessage);
          doLoop = false;
        }
        context.messages = [...context.messages, ...newMessages];
      } else {
        doLoop = false;
      }
    } while (doLoop);
    this.eventProducer.emit(EventName.ChatEnd, {
      context,
      messages: lastLlmResponseMessages,
      modelId: this.chatExecutor.modelId,
      startTime: chatStartMs,
      timeMs: Date.now() - chatStartMs,
    });
    for (const transformer of this.postRunTransformers) {
      responseMessages = await transformer.transform(responseMessages, context);
    }
    const response = {
      responseMessage: responseMessages[responseMessages.length - 1],
      responseMessages,
    };
    return response;
  }

  private async executeToolCalls(
    toolCalls: MessageToolCall[],
    tools: ITool[],
    context: ChatAgentContext,
  ): Promise<MessageTool[]> {
    const toolStartMs = Date.now();
    this.eventProducer.emit(EventName.ToolsStart, {
      context,
      toolCalls,
    });
    const toolMessages = await Promise.all(
      toolCalls.map((toolCall) =>
        this.toolExecutor.execute(toolCall, tools, context),
      ),
    ).then((results) => results.flat());
    this.eventProducer.emit(EventName.ToolsEnd, {
      context,
      toolMessages,
      timeMs: Date.now() - toolStartMs,
    });
    return toolMessages;
  }

  private resolveToolChoice(context: ChatAgentContext): ToolChoice | undefined {
    const name = context.requiredToolName;
    if (name) {
      if (!context.tools.some((tool) => tool.name === name)) {
        throw new Error(`Required tool "${name}" is not in context.tools`);
      }
      return { type: "tool", name };
    }
    if (context.mustCallTool) {
      if (context.tools.length === 0) {
        throw new Error("mustCallTool is set but no tools are available");
      }
      return { type: "required" };
    }
    return undefined;
  }
}
