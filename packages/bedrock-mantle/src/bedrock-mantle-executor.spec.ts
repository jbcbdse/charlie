import {
  resolveBedrockMantleOptions,
  BedrockMantleExecutorOptions,
} from "./bedrock-mantle-executor";

jest.mock("@aws/bedrock-token-generator", () => ({
  getTokenProvider: jest.fn(({ region }: { region: string }) => {
    const provider = jest.fn(async () => `token-for-${region}`);
    return provider;
  }),
}));

import { getTokenProvider } from "@aws/bedrock-token-generator";

const getTokenProviderMock = getTokenProvider as jest.MockedFunction<
  typeof getTokenProvider
>;

describe("resolveBedrockMantleOptions", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    delete process.env.BEDROCK_API_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("uses explicit region over env", () => {
    process.env.AWS_REGION = "us-west-2";
    const resolved = resolveBedrockMantleOptions({ region: "eu-west-1" });
    expect(resolved.baseURL).toBe(
      "https://bedrock-mantle.eu-west-1.api.aws/v1",
    );
  });

  it("prefers AWS_REGION over AWS_DEFAULT_REGION", () => {
    process.env.AWS_REGION = "us-west-2";
    process.env.AWS_DEFAULT_REGION = "eu-central-1";
    const resolved = resolveBedrockMantleOptions();
    expect(resolved.baseURL).toBe(
      "https://bedrock-mantle.us-west-2.api.aws/v1",
    );
  });

  it("falls through empty-string env to default region", () => {
    process.env.AWS_REGION = "";
    process.env.AWS_DEFAULT_REGION = "";
    const resolved = resolveBedrockMantleOptions();
    expect(resolved.baseURL).toBe(
      "https://bedrock-mantle.us-east-1.api.aws/v1",
    );
  });

  it("defaults modelProvider and modelId", () => {
    const resolved = resolveBedrockMantleOptions();
    expect(resolved.modelProvider).toBe("aws-bedrock-mantle");
    expect(resolved.modelId).toBe("openai.gpt-oss-20b");
  });

  it("uses AWS_BEARER_TOKEN_BEDROCK instead of token provider", () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "env-token";
    const resolved = resolveBedrockMantleOptions();
    expect(resolved.apiKey).toBe("env-token");
    expect(getTokenProviderMock).not.toHaveBeenCalled();
  });

  it("does not generate a token when apiKey is provided", () => {
    const resolved = resolveBedrockMantleOptions({ apiKey: "explicit" });
    expect(resolved.apiKey).toBe("explicit");
    expect(getTokenProviderMock).not.toHaveBeenCalled();
  });

  it("does not generate a token when openAiClient is provided", () => {
    const openAiClient = {} as BedrockMantleExecutorOptions["openAiClient"];
    const resolved = resolveBedrockMantleOptions({ openAiClient });
    expect(resolved.openAiClient).toBe(openAiClient);
    expect(resolved.apiKey).toBeUndefined();
    expect(getTokenProviderMock).not.toHaveBeenCalled();
  });

  it("falls back to token provider with resolved region", () => {
    const resolved = resolveBedrockMantleOptions({ region: "ap-south-1" });
    expect(getTokenProviderMock).toHaveBeenCalledWith({ region: "ap-south-1" });
    expect(typeof resolved.apiKey).toBe("function");
  });
});
