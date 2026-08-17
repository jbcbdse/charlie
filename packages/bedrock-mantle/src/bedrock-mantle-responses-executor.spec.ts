import { BedrockMantleResponsesExecutor } from "./bedrock-mantle-responses-executor";
import { BedrockMantleMessagesExecutor } from "./bedrock-mantle-messages-executor";
import { BedrockMantleResponsesExecutorOptions } from "./bedrock-mantle-responses-executor";

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

describe("BedrockMantleResponsesExecutor", () => {
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

  it("defaults modelProvider, modelId, and requests a token", () => {
    const executor = new BedrockMantleResponsesExecutor();
    expect(executor.modelProvider).toBe("aws-bedrock-mantle");
    expect(executor.modelId).toBe("openai.gpt-oss-20b");
    expect(getTokenProviderMock).toHaveBeenCalledWith({ region: "us-east-1" });
  });

  it("does not generate a token when openAiClient is provided", () => {
    const openAiClient =
      {} as BedrockMantleResponsesExecutorOptions["openAiClient"];
    new BedrockMantleResponsesExecutor({ openAiClient });
    expect(getTokenProviderMock).not.toHaveBeenCalled();
  });
});

describe("BedrockMantleMessagesExecutor", () => {
  it("defaults modelProvider and modelId", () => {
    const executor = new BedrockMantleMessagesExecutor({
      anthropicClient: {
        messages: { create: jest.fn() },
      } as never,
    });
    expect(executor.modelProvider).toBe("aws-bedrock-mantle");
    expect(executor.modelId).toBe("anthropic.claude-haiku-4-5");
  });

  it("calls Messages API and maps thinking plus text", async () => {
    const create = jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "message_start",
          message: { usage: { input_tokens: 2 } },
        };
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "hmm" },
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig" },
        };
        yield {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        };
        yield {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "hello" },
        };
        yield {
          type: "message_delta",
          usage: {
            output_tokens: 3,
            output_tokens_details: { thinking_tokens: 1 },
          },
        };
      },
    });
    const executor = new BedrockMantleMessagesExecutor({
      anthropicClient: { messages: { create } } as never,
    });
    const result = await executor.execute({
      messages: [{ role: "user", content: "hi" }],
      context: {
        runId: "run",
        modelId: "anthropic.claude-haiku-4-5",
        messages: [],
        tools: [],
        mustCallTool: false,
        meta: {},
        eventProducer: { emit: jest.fn() },
        systemPrompt: "be nice",
      } as never,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "anthropic.claude-haiku-4-5",
        max_tokens: 8192,
        system: "be nice",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    );
    expect(result.responseMessages).toEqual([
      { role: "reasoning", content: "hmm", signature: "sig" },
      { role: "assistant", content: "hello" },
    ]);
    expect(result.responseMessage).toEqual({
      role: "assistant",
      content: "hello",
    });
    expect(result.usage).toEqual({
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      reasoningTokens: 1,
    });
  });
});
