import { BedrockRuntime } from "@aws-sdk/client-bedrock-runtime";
import {
  TextEmbeddingGenerator,
  TextEmbeddingInput,
  TextEmbeddingOutput,
} from "../core";

interface CohereTextEmbeddingRequest {
  texts: string[];
  input_type: "search_document";
}
interface CohereTextEmbeddingResponse {
  modelId: string;
  texts: string[];
  embeddings: number[][];
  response_type: "embeddings_floats";
}
export class CohereTextEmbeddingGenerator implements TextEmbeddingGenerator {
  public modelId: string;
  private client: BedrockRuntime;
  constructor(options: { modelId: string; client?: BedrockRuntime }) {
    this.modelId = options.modelId;
    this.client = options.client || new BedrockRuntime({});
  }

  public async getEmbedding(
    input: TextEmbeddingInput,
  ): Promise<TextEmbeddingOutput> {
    const request: CohereTextEmbeddingRequest = {
      texts: [input.text],
      input_type: "search_document",
    };
    const response = await this.client.invokeModel({
      modelId: this.modelId,
      body: JSON.stringify(request),
    });
    const data: CohereTextEmbeddingResponse = JSON.parse(
      Buffer.from(response.body).toString(),
    );
    return {
      modelId: this.modelId,
      embedding: data.embeddings[0],
    };
  }
}
