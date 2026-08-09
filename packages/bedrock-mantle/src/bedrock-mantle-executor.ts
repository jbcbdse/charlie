import { getTokenProvider } from "@aws/bedrock-token-generator";
import {
  OpenAiChatExecutor,
  OpenAiChatExecutorOptions,
} from "@jbcbdse/charlie-openai";

export type BedrockMantleExecutorOptions = Omit<
  OpenAiChatExecutorOptions,
  "modelId"
> & {
  modelId?: string;
  region?: string;
};

export class BedrockMantleExecutor extends OpenAiChatExecutor {
  constructor(options: BedrockMantleExecutorOptions = {}) {
    const region =
      options.region ??
      process.env.AWS_REGION ??
      process.env.AWS_DEFAULT_REGION ??
      "us-east-1";

    options.modelProvider ??= "aws-bedrock-mantle";
    options.modelId ??= "openai.gpt-oss-20b";
    options.baseURL ??= `https://bedrock-mantle.${region}.api.aws/v1`;

    if (!options.openAiClient && options.apiKey === undefined) {
      const envKey =
        process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_API_KEY;
      options.apiKey = envKey || getTokenProvider({ region });
    }

    super(options as OpenAiChatExecutorOptions);
  }
}
