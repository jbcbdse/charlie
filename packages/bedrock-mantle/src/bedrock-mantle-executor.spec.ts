import {
  BedrockMantleExecutor,
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

describe("BedrockMantleExecutor", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("uses explicit region over env", () => {
    process.env.AWS_REGION = "us-west-2";
    new BedrockMantleExecutor({ region: "eu-west-1" });
    expect(getTokenProviderMock).toHaveBeenCalledWith({ region: "eu-west-1" });
  });

  it("prefers AWS_REGION over AWS_DEFAULT_REGION", () => {
    process.env.AWS_REGION = "us-west-2";
    process.env.AWS_DEFAULT_REGION = "eu-central-1";
    new BedrockMantleExecutor();
    expect(getTokenProviderMock).toHaveBeenCalledWith({ region: "us-west-2" });
  });

  it("falls through empty-string env to default region", () => {
    process.env.AWS_REGION = "";
    process.env.AWS_DEFAULT_REGION = "";
    new BedrockMantleExecutor();
    expect(getTokenProviderMock).toHaveBeenCalledWith({ region: "us-east-1" });
  });

  it("defaults modelProvider and modelId", () => {
    const executor = new BedrockMantleExecutor();
    expect(executor.modelProvider).toBe("aws-bedrock-mantle");
    expect(executor.modelId).toBe("openai.gpt-oss-20b");
  });

  it("accepts explicit constructor options", () => {
    const executor = new BedrockMantleExecutor({
      modelId: "openai.gpt-oss-120b",
      modelProvider: "custom-mantle",
      region: "eu-west-1",
      apiKey: "explicit",
    });
    expect(executor.modelId).toBe("openai.gpt-oss-120b");
    expect(executor.modelProvider).toBe("custom-mantle");
    expect(getTokenProviderMock).not.toHaveBeenCalled();
  });

  it("uses AWS_BEARER_TOKEN_BEDROCK instead of token provider", () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "env-token";
    new BedrockMantleExecutor();
    expect(getTokenProviderMock).not.toHaveBeenCalled();
  });

  it("does not generate a token when apiKey is provided", () => {
    new BedrockMantleExecutor({ apiKey: "explicit" });
    expect(getTokenProviderMock).not.toHaveBeenCalled();
  });

  it("does not generate a token when openAiClient is provided", () => {
    const openAiClient = {} as BedrockMantleExecutorOptions["openAiClient"];
    new BedrockMantleExecutor({ openAiClient });
    expect(getTokenProviderMock).not.toHaveBeenCalled();
  });

  it("passes profile to token provider from options", () => {
    new BedrockMantleExecutor({ region: "ap-south-1", profile: "default" });
    expect(getTokenProviderMock).toHaveBeenCalledWith({
      region: "ap-south-1",
      profile: "default",
    });
  });

  it("passes profile to token provider from AWS_PROFILE", () => {
    process.env.AWS_PROFILE = "default";
    new BedrockMantleExecutor({ region: "us-east-1" });
    expect(getTokenProviderMock).toHaveBeenCalledWith({
      region: "us-east-1",
      profile: "default",
    });
  });
});
