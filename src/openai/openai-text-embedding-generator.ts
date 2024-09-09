import axios, { AxiosInstance } from "axios";
import {
  TextEmbeddingGenerator,
  TextEmbeddingInput,
  TextEmbeddingOutput,
} from "../core/types";

export interface OpenAiTextEmbeddingGeneratorOptions {
  apiKey: string;
  dimensions?: number;
  modelId: string;
  axiosInstance?: AxiosInstance;
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
  private apiKey: string;
  public modelId: string;
  private axios: AxiosInstance;
  constructor(options: OpenAiTextEmbeddingGeneratorOptions) {
    this.apiKey = options.apiKey;
    this.dimensions = options.dimensions;
    this.modelId = options.modelId;
    this.axios = options.axiosInstance ?? axios.create();
  }
  public async getEmbedding(
    input: TextEmbeddingInput,
  ): Promise<TextEmbeddingOutput> {
    const request = {
      input: input.text,
      model: this.modelId,
      encoding_format: "float",
      dimensions: this.dimensions,
    };
    const response = await this.axios.post(
      "https://api.openai.com/v1/embeddings",
      request,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
    );
    const data: OpenAiEmbeddingResponse = response.data;
    return {
      modelId: this.modelId,
      embedding: data.data[0].embedding,
    };
  }
}
