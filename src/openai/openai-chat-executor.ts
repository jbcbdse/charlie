import axios, { AxiosInstance } from "axios";
import { OpenAiChatMessage, OpenAiCompletionsRequest } from "./types";
import {
  ChatExecutor,
  ChatAgentGetResponseOutput,
  ChatMessage,
  ChatExecutorInput,
} from "../core/types";
import { ILogger } from "../core/logger";
import { TemplateSerializer } from "../core/template-serializer";
import {
  EventName,
  eventProducer,
  EventProducer,
} from "../core/event-producer";
import zodToJsonSchema from "zod-to-json-schema";

export class OpenAiChatExecutor implements ChatExecutor {
  private apiKey: string;
  private axios: AxiosInstance;
  private eventProducer: EventProducer;
  public modelId: string;
  constructor(
    private options: {
      modelId: string;
      logger?: ILogger;
      systemPromptTemplate?: string;
      promptSerializer?: TemplateSerializer;
      apiKey: string;
      axoisInstance?: AxiosInstance;
      eventProducer?: EventProducer;
    },
  ) {
    this.options.modelId ??= "gpt-4o";
    this.modelId = this.options.modelId;
    this.apiKey = options.apiKey;
    this.axios = options.axoisInstance ?? axios.create();
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
            parameters: zodToJsonSchema(tool.schema),
          },
        })),
    };
    const chatExecutorStartMs = Date.now();
    this.eventProducer.emit(EventName.ChatRawRequest, {
      context,
      request,
      modelId: this.modelId,
    });
    const response = await this.axios.post(
      "https://api.openai.com/v1/chat/completions",
      request,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.data;
    this.eventProducer.emit(EventName.ChatRawResponse, {
      context,
      response: data,
      modelId: this.modelId,
      timeMs: Date.now() - chatExecutorStartMs,
    });
    if (response.status !== 200) {
      throw new Error(data.error.message);
    }
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
        content: message.content,
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
