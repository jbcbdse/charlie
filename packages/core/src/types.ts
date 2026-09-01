/*
These types are designed roughly based on the OpenAI Chat API and the Bedrock Converse API with Typescript and history storage in mind.

They are designed to be flexible enough to use with any modern LLM, while not every property may be supported by every possible agent.

These types should be suitable for storing history with a clear idea of what happened during chat. This format allows you to see the tool calls inline with the rest of the chat history, even if you generally exclude those messages from subsequent inference calls.
*/

import type { ITool } from "./base-tool";
import type { EventProducer } from "./event-producer";
import type {
  EventName,
  EventTypeMap,
  EventChatStreamChunk,
} from "./event-producer";

/**
 * A system message in the chat
 *
 * This can be an opening system prompt, or it can be a message from the system interlaced in the conversation
 * Some models do not support system messages as part of the conversation, so they may be formatted as a different role when provided to the model
 */
export interface MessageSystem {
  role: "system";
  content: string;
  /** The name of the specific actor in this role, possibly not supported by all agents */
  name?: string;
}
/**
 * Binary media on a chat message (image, PDF, etc.).
 *
 * `data` is base64 (JSON history / HTTP) or raw bytes. Node `Buffer` is a
 * `Uint8Array`. Executors map this to the vendor media block when the API
 * supports the MIME type; otherwise they leave a text placeholder.
 */
export interface Attachment {
  mimeType: string;
  data: string | Uint8Array;
  name?: string;
}
/**
 * A user message in the chat
 *
 * This is a message from the user in the conversation. Depending on the use case, this may not be a literal message from the user, but a message that represents the user's intent as derived by the system or summarized message history
 */
export interface MessageUser {
  role: "user";
  content: string;
  attachments?: Attachment[];
  /** The name of the specific actor in this role, possibly not supported by all agents */
  name?: string;
}
/**
 * An assising message in the chat
 *
 * This is a response from the AI assitiant It may contain tool calls.
 *
 * Some APIs support tool calls directly, such as the OpenAI API and the Bedrock Converse API. Others may require the agent to parse the AI response for tool calls
 */
export interface MessageAssistant {
  role: "assistant";
  content: string;
  attachments?: Attachment[];
  /** The name of the specific actor in this role, possibly not supported by all agents */
  name?: string;
}
/**
 * Provider reasoning that must be round-tripped on the next request.
 *
 * OpenAI Responses (stateless `store: false`) uses `id` + `encryptedContent`.
 * Anthropic Messages uses `content` + `signature` (thinking blocks).
 */
export interface MessageReasoning {
  role: "reasoning";
  id?: string;
  encryptedContent?: string;
  content?: string;
  signature?: string;
}
export interface MessageToolCall {
  role: "tool_call";
  toolCalls: ToolCall[];
}
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** This should be the actual value passed to the tool, after it has been parsed from the AI response */
    arguments: Record<string, unknown>;
  };
}
/**
 * A message from a tool in the chat
 *
 * Some models/APIs may not support this as a message role, so the agent may reformat this as something different in the message history
 */
export interface MessageTool {
  role: "tool";
  content: string;
  attachments?: Attachment[];
  /** The name of the tool that was called */
  name: string;
  toolCallId: string;
  returnDirect: boolean;
  status: "success" | "error";
}

/**
 * A transformer that can be used to modify an array of chat messages, a subset of the chat history
 *
 * This is useful as a process messages before or after tool calls.
 * `preRunTransformers` also run here: return the messages to send, and mutate
 * `context.tools` to filter or replace the tool list for the run.
 */
export interface ChatMessageTransformer {
  transform(
    messages: ChatMessage[],
    context: ChatAgentContext,
  ): ChatMessage[] | Promise<ChatMessage[]>;
}

/**
 * A chat message as you might have stored in history
 */
export type ChatMessage =
  | MessageSystem
  | MessageUser
  | MessageAssistant
  | MessageReasoning
  | MessageToolCall
  | MessageTool;
/**
 * Arbitrary data you can include in context that will be passed to tools and callbacks
 *
 * This property can also be referenced by prompt templates
 */
type ChatAgentContentMeta = Record<string, unknown>;
export interface ChatAgentContext {
  runId: string;
  modelId: string;
  messages: ChatMessage[];
  /**
   * Tools available for this run. The agent always sets this to an array
   * (copy of `getResponse` tools). `preRunTransformers` may replace or
   * filter it; later loop iterations use the mutated list.
   */
  tools: ITool[];
  meta: ChatAgentContentMeta;
  eventProducer: EventProducer;
  /** Set by ToolExecutor for the duration of handle(). */
  toolName?: string;
  /** Set by ToolExecutor for the duration of handle(). */
  toolCallId?: string;
  /**
   * The system prompt template that can be mutated by tools to affect
   * subsequent loop iterations. The agent serializes this template on every
   * iteration using the current `meta` values.
   */
  systemPromptTemplate?: string;
  /**
   * The synthesized system prompt for the current loop iteration, serialized
   * from `systemPromptTemplate` and `meta`. This is regenerated each iteration
   * by the agent. Tools should mutate `systemPromptTemplate` instead.
   */
  systemPrompt?: string;
  /**
   * When true, the model must call at least one tool. Mutable mid-run.
   */
  mustCallTool?: boolean;
  /**
   * When set, the model must call this tool. Wins over `mustCallTool`.
   * Mutable mid-run.
   */
  requiredToolName?: string;
}
export interface ChatAgentGetResponseInput {
  messages: ChatMessage[];
  tools?: ITool[];
  systemPrompt?: string;
  meta?: ChatAgentContentMeta;
  /** When true, the model must call at least one tool. Copied onto context. */
  mustCallTool?: boolean;
  /** When set, the model must call this tool. Wins over `mustCallTool`. */
  requiredToolName?: string;
}
/** Token counts from one executor call. `reasoningTokens` is a breakdown when the provider reports it. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}
export interface ChatAgentGetResponseOutput {
  responseMessage: ChatMessage;
  responseMessages: ChatMessage[];
  usage?: TokenUsage;
}
export type ChatRun = Promise<ChatAgentGetResponseOutput> & {
  on<T extends EventName>(
    eventName: T,
    listener: (event: EventTypeMap[T], eventName: T) => void,
  ): ChatRun;
  off<T extends EventName>(
    eventName: T,
    listener: (event: EventTypeMap[T], eventName: T) => void,
  ): ChatRun;
  [Symbol.asyncIterator](): AsyncIterableIterator<EventChatStreamChunk>;
};
export interface ChatAgent {
  getResponse(input: ChatAgentGetResponseInput): ChatRun;
}
export type ToolChoice = { type: "required" } | { type: "tool"; name: string };
export interface ChatExecutorInput {
  messages: ChatMessage[];
  tools?: ITool[];
  context: ChatAgentContext;
  /**
   * Resolved by AiChatAgent from context.mustCallTool / requiredToolName.
   * Omit for provider auto.
   */
  toolChoice?: ToolChoice;
}
export interface ChatExecutor {
  /**
   * The id of the model to use for this executor, specific to the model within the given API
   */
  modelId: string;
  /**
   * The model provider to use for this executor, specific to the model within the given API
   *
   * This is used for monitoring, such as with Datadog LLM Observability
   */
  modelProvider: string;
  execute(input: ChatExecutorInput): Promise<ChatAgentGetResponseOutput>;
}

export interface TextEmbeddingInput {
  text: string;
}
export interface TextEmbeddingOutput {
  modelId: string;
  embedding: number[];
}
export interface TextEmbeddingGenerator {
  getEmbedding(input: TextEmbeddingInput): Promise<TextEmbeddingOutput>;
}
