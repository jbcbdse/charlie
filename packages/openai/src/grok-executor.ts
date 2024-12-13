import {
  OpenAiChatExecutor,
  OpenAiChatExecutorOptions,
} from "./openai-chat-executor";
import axios from "axios";

export type GrokExecutorOptions = OpenAiChatExecutorOptions;
export class GrokExecutor extends OpenAiChatExecutor {
  constructor(options: GrokExecutorOptions) {
    options.modelId ??= "grok-beta";
    options.axoisInstance ??= axios.create({
      baseURL: "https://api.x.ai/v1/",
    });
    super(options);
  }
}
