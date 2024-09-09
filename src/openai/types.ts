interface OpenAiSystemMessage {
  role: "system";
  content: string;
  name?: string;
}
interface OpenAiUserMessage {
  role: "user";
  /** OpenAI supports a more complex array of content parts where each part can be an object representing text or an image URL. Those are not implemented here */
  content: string;
  name?: string;
}
interface OpenAiAssistantMessage {
  role: "assistant";
  content: string;
  name?: string;
  tool_calls?: OpenAiAssistantToolCall[];
}
interface OpenAiToolMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
}
interface OpenAiAssistantToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** The arguments formatted as JSON, and may include hallucinations */
    arguments: string;
  };
}
export type OpenAiChatMessage =
  | OpenAiSystemMessage
  | OpenAiUserMessage
  | OpenAiAssistantMessage
  | OpenAiToolMessage;
interface OpenAiTool {
  type: "function";
  function: {
    description?: string;
    name: string;
    /** The parameters to the function in JSON Schema format */
    parameters: Record<string, unknown>;
  };
}
export interface OpenAiCompletionsRequest {
  messages: OpenAiChatMessage[];
  model: string;
  tools?: OpenAiTool[];
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } };
}
