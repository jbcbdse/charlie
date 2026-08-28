interface OpenAiSystemMessage {
  role: "system";
  content: string;
  name?: string;
}
interface OpenAiUserMessage {
  role: "user";
  content: string | OpenAiContentPart[];
  name?: string;
}
interface OpenAiAssistantMessage {
  role: "assistant";
  content: string | OpenAiContentPart[] | null;
  name?: string;
  tool_calls?: OpenAiAssistantToolCall[];
}
interface OpenAiToolMessage {
  role: "tool";
  content: string | OpenAiContentPart[];
  tool_call_id: string;
}
type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename?: string; file_data: string } };
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
