import {
  OpenAiChatExecutor,
  OpenAiChatExecutorOptions,
} from "./openai-chat-executor";

export type GrokExecutorOptions = OpenAiChatExecutorOptions;
export class GrokExecutor extends OpenAiChatExecutor {
  constructor(options: GrokExecutorOptions) {
    options.modelProvider ??= "xAI";
    options.modelId ??= "grok-beta";
    options.baseURL ??= "https://api.x.ai/v1/";
    super(options);
  }
}
