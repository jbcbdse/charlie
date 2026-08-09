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

export function resolveBedrockMantleOptions(
  options: BedrockMantleExecutorOptions = {},
): OpenAiChatExecutorOptions {
  const region =
    options.region ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1";

  const resolved: OpenAiChatExecutorOptions = {
    ...options,
    modelProvider: options.modelProvider ?? "aws-bedrock-mantle",
    modelId: options.modelId ?? "openai.gpt-oss-20b",
    baseURL: options.baseURL ?? `https://bedrock-mantle.${region}.api.aws/v1`,
  };

  if (!resolved.openAiClient && resolved.apiKey === undefined) {
    const envKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
    resolved.apiKey = envKey || getTokenProvider({ region });
  }

  return resolved;
}

export class BedrockMantleExecutor extends OpenAiChatExecutor {
  constructor(options: BedrockMantleExecutorOptions = {}) {
    super(resolveBedrockMantleOptions(options));
  }
}
