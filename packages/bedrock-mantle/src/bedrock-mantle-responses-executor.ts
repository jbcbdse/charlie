import {
  OpenAiResponsesExecutor,
  OpenAiResponsesExecutorOptions,
} from "@jbcbdse/charlie-openai";
import {
  bedrockMantleBaseURL,
  MantleAuthOptions,
  resolveMantleApiKey,
} from "./mantle-options";

export type BedrockMantleResponsesExecutorOptions = Omit<
  OpenAiResponsesExecutorOptions,
  "modelId"
> &
  MantleAuthOptions & {
    modelId?: string;
  };

export class BedrockMantleResponsesExecutor extends OpenAiResponsesExecutor {
  constructor(options: BedrockMantleResponsesExecutorOptions = {}) {
    super(BedrockMantleResponsesExecutor.resolveOptions(options));
  }

  private static resolveOptions(
    options: BedrockMantleResponsesExecutorOptions,
  ): OpenAiResponsesExecutorOptions {
    const resolved: OpenAiResponsesExecutorOptions = {
      ...options,
      modelProvider: options.modelProvider ?? "aws-bedrock-mantle",
      modelId: options.modelId ?? "openai.gpt-oss-20b",
      baseURL: options.baseURL ?? bedrockMantleBaseURL("v1", options.region),
    };
    if (!resolved.openAiClient && resolved.apiKey === undefined) {
      resolved.apiKey = resolveMantleApiKey(options);
    }
    return resolved;
  }
}
