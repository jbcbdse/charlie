import EventEmitter from "events";
import { ChatAgentContext, ChatMessage } from "./types";

interface ChatEvent {
  context: ChatAgentContext;
}
interface ChatEndEvent extends ChatEvent {
  timeMs: number;
}
export interface EventChatStart extends ChatEvent {
  modelId: string;
  /**
   * Messages sent to the LLM
   */
  messages: ChatMessage[];
  systemPrompt?: string;
}
export interface EventChatEnd extends ChatEndEvent {
  modelId: string;
  /** Messages in response from the LLM */
  messages: ChatMessage[];
}
export interface EventToolsStart extends ChatEvent {
  toolCalls: ChatMessage[];
}
export interface EventToolsEnd extends ChatEndEvent {
  toolMessages: ChatMessage[];
}
export interface EventToolStart extends ChatEvent {
  toolCall: ChatMessage;
  toolCallId: string;
}
export interface EventToolEnd extends ChatEndEvent {
  toolMessage: ChatMessage;
}
export interface EventChatExecutorStart extends ChatEvent {
  modelId: string;
  messages: ChatMessage[];
  systemPrompt?: string;
}
export interface EventChatExecutorEnd extends ChatEndEvent {
  modelId: string;
  messages: ChatMessage[];
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
export type EventTypeMap = {
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
};

export class EventProducer {
  public emitter = new EventEmitter();
  public emit<T extends EventName>(eventName: T, event: EventTypeMap[T]): void {
    this.emitter.emit(eventName, event, eventName);
  }
}

export const eventProducer = new EventProducer();
