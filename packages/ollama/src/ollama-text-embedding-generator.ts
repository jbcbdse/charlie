import {
  OpenAiTextEmbeddingGenerator,
  OpenAiTextEmbeddingGeneratorOptions,
} from "@jbcbdse/charlie-openai";

export type OllamaTextEmbeddingGeneratorOptions = Omit<
  OpenAiTextEmbeddingGeneratorOptions,
  "modelId"
> & {
  modelId?: string;
};

export class OllamaTextEmbeddingGenerator extends OpenAiTextEmbeddingGenerator {
  constructor(options: OllamaTextEmbeddingGeneratorOptions = {}) {
    super(OllamaTextEmbeddingGenerator.resolveOptions(options));
  }

  private static resolveOptions(
    options: OllamaTextEmbeddingGeneratorOptions,
  ): OpenAiTextEmbeddingGeneratorOptions {
    return {
      ...options,
      modelId: options.modelId ?? "nomic-embed-text",
      baseURL:
        options.baseURL ||
        process.env.OLLAMA_BASE_URL ||
        "http://localhost:11434/v1",
      apiKey: options.apiKey || process.env.OLLAMA_API_KEY || "ollama",
    };
  }
}
