import OpenAI from "openai";
import {
  TextEmbeddingGenerator,
  TextEmbeddingInput,
  TextEmbeddingOutput,
} from "@ifit/charlie-core";

export interface OpenAiTextEmbeddingGeneratorOptions {
  dimensions?: number;
  modelId: string;
  openAiClient?: OpenAI;
  apiKey?: string;
  baseURL?: string;
  maxRetries?: number;
  timeout?: number;
}

interface OpenAiEmbeddingResponse {
  object: "list";
  data: OpenAiEmbeddingResponseEmbedding[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}
interface OpenAiEmbeddingResponseEmbedding {
  object: "embedding";
  index: number;
  embedding: number[];
}
export class OpenAiTextEmbeddingGenerator implements TextEmbeddingGenerator {
  private dimensions?: number;
  private openAiClient: OpenAI;
  public modelId: string;
  constructor(options: OpenAiTextEmbeddingGeneratorOptions) {
    this.dimensions = options.dimensions;
    this.modelId = options.modelId;
    this.openAiClient =
      options.openAiClient ??
      new OpenAI({
        baseURL: options.baseURL || "https://api.openai.com/v1/",
        apiKey: options.apiKey || "",
        maxRetries: options.maxRetries || undefined,
        timeout: options.timeout || undefined,
      });
  }
  public async getEmbedding(
    input: TextEmbeddingInput,
  ): Promise<TextEmbeddingOutput> {
    const request = {
      input: input.text,
      model: this.modelId,
      encoding_format: "float" as const,
      dimensions: this.dimensions,
    };
    const data: OpenAiEmbeddingResponse =
      await this.openAiClient.embeddings.create(request);

    return {
      modelId: this.modelId,
      embedding: data.data[0].embedding,
    };
  }
}
