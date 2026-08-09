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
  /** AWS shared-config profile for short-term bearer token generation. */
  profile?: string;
};

export class BedrockMantleExecutor extends OpenAiChatExecutor {
  constructor(options: BedrockMantleExecutorOptions = {}) {
    super(BedrockMantleExecutor.resolveOptions(options));
  }

  private static resolveOptions(
    options: BedrockMantleExecutorOptions,
  ): OpenAiChatExecutorOptions {
    const region =
      options.region ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "us-east-1";
    const profile = options.profile || process.env.AWS_PROFILE || undefined;

    const resolved: OpenAiChatExecutorOptions = {
      ...options,
      modelProvider: options.modelProvider ?? "aws-bedrock-mantle",
      modelId: options.modelId ?? "openai.gpt-oss-20b",
      baseURL: options.baseURL ?? `https://bedrock-mantle.${region}.api.aws/v1`,
    };

    if (!resolved.openAiClient && resolved.apiKey === undefined) {
      const envKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
      resolved.apiKey =
        envKey || getTokenProvider({ region, ...(profile ? { profile } : {}) });
    }

    return resolved;
  }
}
