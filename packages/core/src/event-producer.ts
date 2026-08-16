import EventEmitter from "events";
import {
  ChatAgentContext,
  ChatMessage,
  MessageTool,
  MessageToolCall,
  TokenUsage,
} from "./types";

interface ChatEvent {
  context: ChatAgentContext;
}
interface ChatEndEvent extends ChatEvent {
  timeMs: number;
}
export interface EventChatStart extends ChatEvent {
  modelId: string;
  startTime: number;
  /**
   * Messages sent to the LLM
   */
  messages: ChatMessage[];
  systemPrompt?: string;
}
export interface EventChatEnd extends ChatEndEvent {
  modelId: string;
  startTime: number;
  timeMs: number;
  /** Messages in response from the LLM */
  messages: ChatMessage[];
}
export interface EventToolsStart extends ChatEvent {
  toolCalls: MessageToolCall[];
}
export interface EventToolsEnd extends ChatEndEvent {
  toolMessages: MessageTool[];
}
export interface EventToolStart extends ChatEvent {
  startTime: number;
  toolCall: MessageToolCall;
  toolCallId: string;
}
export interface EventToolEnd extends ChatEndEvent {
  startTime: number;
  toolCall: MessageToolCall;
  toolCallId: string;
  toolMessage: MessageTool;
}
export interface EventChatExecutorStart extends ChatEvent {
  modelId: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  startTime: number;
}
export interface EventChatExecutorEnd extends ChatEndEvent {
  modelId: string;
  modelProvider: string;
  messages: ChatMessage[];
  startTime: number;
  timeMs: number;
  responseMessages: ChatMessage[];
  usage?: TokenUsage;
}
export interface EventChatRawRequest extends ChatEvent {
  modelId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: any;
}
export interface EventChatRawResponse extends ChatEndEvent {
  modelId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any;
}
export interface EventToolProgress extends ChatEvent {
  message: string;
  toolName?: string;
  toolCallId?: string;
}
export type LogLevel = "error" | "warn" | "info" | "debug" | "verbose";
export interface EventLog extends ChatEvent {
  message: string;
  level: LogLevel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: Record<string, any>;
  toolName?: string;
  toolCallId?: string;
}

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool_call";
      index: number;
      id?: string;
      name?: string;
      argumentsText?: string;
    };

export interface EventChatStreamChunk extends ChatEvent {
  modelId: string;
  modelProvider: string;
  chunk: StreamChunk;
}

/**
 * Events that can be emitted by the event producer and can be subscribed to by the event subscriber
 */
export enum EventName {
  /** When the AI Chat Agent run starts */
  ChatStart = "chat:start",
  /** When the AI Chat Agent run ends */
  ChatEnd = "chat:end",
  /** Before tools are executed after an AI response */
  ToolsStart = "tools:start",
  /** After tools are executed after an AI response */
  ToolsEnd = "tools:end",
  /** Before an individual tool isexecuted after an AI response */
  ToolStart = "tool:start",
  /** After an individual tool isexecuted after an AI response */
  ToolEnd = "tool:end",
  /** Before a chat executor is invoked to get a response, could happen more than once if tools are called */
  ChatExecutorStart = "chat:executor:start",
  /** After a chat executor is invoked to get a response, could happen more than once if tools are called */
  ChatExecutorEnd = "chat:executor:end",
  /** Emitted by a chat executor to show the raw API request. Shape will vary by executor */
  ChatRawRequest = "chat:raw:request",
  /** Emitted by a chat executor to show the raw API response. Shape will vary by executor */
  ChatRawResponse = "chat:raw:response",
  /** Emitted by a tool while it is running to surface progress updates to subscribers */
  ToolProgress = "tool:progress",
  /** General-purpose structured log line emitted from anywhere with access to the context */
  Log = "log",
  /** Append-only token slice from a streaming executor */
  ChatStreamChunk = "chat:stream:chunk",
}
/**
 * Map of event names to event types
 *
 * You can find the shape of an event by matching the EventName to the key of EventTypeMap
 *
 * You generally don't need to reference this directly if you subscribe to a single event.
 *
 * @example
 * ```typescript
 * // types will be inferred correctly
 * events.on(EventName.ChatStart, (event, eventName) => { console.log(eventName, event); });
 * ```
 *
 * However, if you use an iterator to subscribe to multiple events, you may need to reference this to get the specific event.
 *
 * @example
 * ```typescript
 * // assume variable `event` is one of the events, and eventName is EventName:
 * if (eventName === EventName.ChatStart) {
 *   const chatStartEvent = event as EventTypeMap[EventName.ChatStart];
 * }
 * ```
 */
export interface EventTypeMap {
  [EventName.ChatStart]: EventChatStart;
  [EventName.ChatEnd]: EventChatEnd;
  [EventName.ToolsStart]: EventToolsStart;
  [EventName.ToolsEnd]: EventToolsEnd;
  [EventName.ToolStart]: EventToolStart;
  [EventName.ToolEnd]: EventToolEnd;
  [EventName.ChatExecutorStart]: EventChatExecutorStart;
  [EventName.ChatExecutorEnd]: EventChatExecutorEnd;
  [EventName.ChatRawRequest]: EventChatRawRequest;
  [EventName.ChatRawResponse]: EventChatRawResponse;
  [EventName.ToolProgress]: EventToolProgress;
  [EventName.Log]: EventLog;
  [EventName.ChatStreamChunk]: EventChatStreamChunk;
}

export class EventProducer {
  public emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  public emit<T extends EventName>(eventName: T, event: EventTypeMap[T]): void {
    this.emitter.emit(eventName, this.withToolStamp(eventName, event), eventName);
  }

  private withToolStamp<T extends EventName>(
    eventName: T,
    event: EventTypeMap[T],
  ): EventTypeMap[T] {
    if (
      eventName !== EventName.ToolProgress &&
      eventName !== EventName.Log
    ) {
      return event;
    }
    const { toolName, toolCallId } = event.context;
    return { ...event, toolName, toolCallId };
  }
}

export const eventProducer = new EventProducer();
