import OpenAI from "openai";
import { OpenAiChatMessage, OpenAiCompletionsRequest } from "./types";
import {
  ChatExecutor,
  ChatAgentGetResponseOutput,
  ChatMessage,
  ChatExecutorInput,
  TemplateSerializer,
  EventName,
  eventProducer,
  EventProducer,
} from "@jbcbdse/charlie-core";

export interface OpenAiChatExecutorOptions {
  modelId: string;
  promptSerializer?: TemplateSerializer;
  openAiClient?: OpenAI;
  apiKey?: string;
  baseURL?: string;
  dangerouslyAllowBrowser?: boolean;
  eventProducer?: EventProducer;
  maxRetries?: number;
  timeout?: number;
}
export class OpenAiChatExecutor implements ChatExecutor {
  private openAiClient: OpenAI;
  private eventProducer: EventProducer;
  public modelId: string;
  constructor(private options: OpenAiChatExecutorOptions) {
    this.options.modelId ??= "gpt-4o";
    this.modelId = this.options.modelId;
    this.openAiClient =
      options.openAiClient ??
      new OpenAI({
        baseURL: options.baseURL || "https://api.openai.com/v1/",
        apiKey: options.apiKey || "",
        dangerouslyAllowBrowser: options.dangerouslyAllowBrowser || false,
        maxRetries: options.maxRetries || undefined,
        timeout: options.timeout || undefined,
      });
    this.eventProducer = options.eventProducer ?? eventProducer;
  }
  public async execute({
    messages,
    tools,
    systemPrompt,
    context,
  }: ChatExecutorInput): Promise<ChatAgentGetResponseOutput> {
    const openAiMessages = this.toOpenAiMessages(messages);
    if (systemPrompt) {
      openAiMessages.unshift({
        role: "system",
        content: systemPrompt,
      });
    }
    const request: OpenAiCompletionsRequest = {
      model: this.options.modelId,
      messages: openAiMessages,
      tools:
        tools &&
        tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.jsonSchema,
          },
        })),
    };
    const chatExecutorStartMs = Date.now();
    this.eventProducer.emit(EventName.ChatRawRequest, {
      context,
      request,
      modelId: this.modelId,
    });
    const data = await this.openAiClient.chat.completions.create(request);
    this.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      response: data,
      modelId: this.modelId,
      timeMs: Date.now() - chatExecutorStartMs,
    });
    const responseMessage: OpenAiChatMessage = data.choices[0].message;
    const msg = this.responseToChatMessage(responseMessage);
    return {
      responseMessage: msg,
      responseMessages: [msg],
    };
  }

  /**
   * When OpenAI responds, it does not include a text message with tool calls, only one or the other
   * and it should always be an "assistant" message
   */
  private responseToChatMessage(message: OpenAiChatMessage): ChatMessage {
    if (message.role !== "assistant") {
      throw new Error(`Unexpected response message role: ${message.role}`);
    }
    if (message?.tool_calls && message.tool_calls?.length > 0) {
      return {
        role: "tool_call",
        toolCalls: message.tool_calls.map((toolCall) => ({
          function: {
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments),
          },
          type: "function",
          id: toolCall.id,
        })),
      };
    } else {
      return {
        role: "assistant",
        content: message.content || "",
        name: message.name,
      };
    }
  }

  private toOpenAiMessages(messages: ChatMessage[]): OpenAiChatMessage[] {
    return messages.map((msg) => {
      if (msg.role === "user") {
        return {
          role: "user",
          content: msg.content,
          name: msg.name,
        };
      }
      if (msg.role === "system") {
        return {
          role: "system",
          content: msg.content,
          name: msg.name,
        };
      }
      if (msg.role === "tool_call") {
        return {
          role: "assistant",
          content: "",
          tool_calls: msg.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.function.name,
              arguments: JSON.stringify(toolCall.function.arguments),
            },
          })),
        };
      }
      if (msg.role === "assistant") {
        return {
          role: "assistant",
          content: msg.content,
          name: msg.name,
        };
      }
      if (msg.role === "tool") {
        return {
          role: "tool",
          content: msg.content,
          tool_call_id: msg.toolCallId,
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`Unknown message role: ${(msg as any)?.role}`);
    });
  }
}
