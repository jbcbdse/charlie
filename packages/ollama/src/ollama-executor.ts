import {
  OpenAiChatExecutor,
  OpenAiChatExecutorOptions,
} from "@jbcbdse/charlie-openai";

export type OllamaExecutorOptions = Omit<
  OpenAiChatExecutorOptions,
  "modelId"
> & {
  modelId?: string;
};

export class OllamaExecutor extends OpenAiChatExecutor {
  constructor(options: OllamaExecutorOptions = {}) {
    super(OllamaExecutor.resolveOptions(options));
  }

  private static resolveOptions(
    options: OllamaExecutorOptions,
  ): OpenAiChatExecutorOptions {
    return {
      ...options,
      modelProvider: options.modelProvider ?? "ollama",
      modelId: options.modelId ?? "qwen3.6:35b-a3b",
      baseURL:
        options.baseURL ??
        process.env.OLLAMA_BASE_URL ??
        "http://localhost:11434/v1",
      apiKey: options.apiKey ?? process.env.OLLAMA_API_KEY ?? "ollama",
    };
  }
}
