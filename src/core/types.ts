/*
These types are designed roughly based on the OpenAI Chat API and the Bedrock Converse API with Typescript and history storage in mind.

They are designed to be flexible enough to use with any modern LLM, while not every property may be supported by every possible agent.

These types should be suitable for storing history with a clear idea of what happened during chat. This format allows you to see the tool calls inline with the rest of the chat history, even if you generally exclude those messages from subsequent inference calls.
*/

import type { BaseTool } from "./base-tool";

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
 * A user message in the chat
 *
 * This is a message from the user in the conversation. Depending on the use case, this may not be a literal message from the user, but a message that represents the user's intent as derived by the system or summarized message history
 */
export interface MessageUser {
  role: "user";
  content: string;
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
  /** The name of the specific actor in this role, possibly not supported by all agents */
  name?: string;
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
    arguments: unknown;
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
  /** The name of the tool that was called */
  name: string;
  toolCallId: string;
  status: "success" | "error";
}

/**
 * A transformer that can be used to modify an array of chat messages, a subset of the chat history
 *
 * This is useful as a process messages before or after tool calls
 */
export interface ChatMessageTransformer {
  transform(messages: ChatMessage[]): ChatMessage[] | Promise<ChatMessage[]>;
}

/**
 * A chat message as you might have stored in history
 */
export type ChatMessage =
  | MessageSystem
  | MessageUser
  | MessageAssistant
  | MessageToolCall
  | MessageTool;

/**
 * Arbitrary data you can include in context that will be passed to tools and callbacks
 *
 * This property can also be referenced by prompt templates
 */
interface ChatAgentContentMeta {
  [key: string]: unknown;
}
export interface ChatAgentContext {
  runId: string;
  modelId: string;
  messages: ChatMessage[];
  meta: ChatAgentContentMeta;
}
export interface ChatAgentGetResponseInput {
  messages: ChatMessage[];
  tools?: BaseTool[];
  systemPrompt?: string;
  meta?: ChatAgentContentMeta;
}
export interface ChatAgentGetResponseOutput {
  responseMessage: ChatMessage;
  responseMessages: ChatMessage[];
}
export interface ChatAgent {
  getResponse(
    input: ChatAgentGetResponseInput,
  ): Promise<ChatAgentGetResponseOutput>;
}
export interface ChatExecutorInput {
  messages: ChatMessage[];
  tools?: BaseTool[];
  systemPrompt?: string;
  context: ChatAgentContext;
}
export interface ChatExecutor {
  /**
   * The id of the model to use for this executor, specific to the model within the given API
   */
  modelId: string;
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
