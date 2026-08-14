import { EventProducer, ITool } from "@jbcbdse/charlie-core";
import { OpenAiChatExecutor } from "./openai-chat-executor";
import { OpenAiCompletionsRequest } from "./types";

const tool: ITool = {
  name: "CalculatorTool",
  description: "math",
  jsonSchema: { type: "object", properties: {} },
  handle: async () => "ok",
};

function mockClient(create: jest.Mock) {
  return {
    chat: { completions: { create } },
  } as unknown as ConstructorParameters<
    typeof OpenAiChatExecutor
  >[0]["openAiClient"];
}

function context() {
  return {
    runId: "run",
    modelId: "test",
    messages: [],
    meta: {},
    eventProducer: new EventProducer(),
  };
}

function createMock() {
  return jest.fn().mockResolvedValue({
    choices: [{ message: { role: "assistant", content: "ok" } }],
  });
}

describe("OpenAiChatExecutor reasoning_effort", () => {
  it("sets reasoning_effort none for grok models when tools are present", async () => {
    const create = createMock();
    const executor = new OpenAiChatExecutor({
      modelId: "xai.grok-4.3",
      openAiClient: mockClient(create),
    });
    await executor.execute({
      messages: [{ role: "user", content: "hi" }],
      tools: [tool],
      context: context(),
    });
    const request = create.mock.calls[0][0] as OpenAiCompletionsRequest;
    expect(request.reasoning_effort).toBe("none");
  });

  it("omits reasoning_effort for grok when tools are absent", async () => {
    const create = createMock();
    const executor = new OpenAiChatExecutor({
      modelId: "grok-4.3",
      openAiClient: mockClient(create),
    });
    await executor.execute({
      messages: [{ role: "user", content: "hi" }],
      context: context(),
    });
    const request = create.mock.calls[0][0] as OpenAiCompletionsRequest;
    expect(request.reasoning_effort).toBeUndefined();
  });

  it("does not default reasoning_effort for non-grok models with tools", async () => {
    const create = createMock();
    const executor = new OpenAiChatExecutor({
      modelId: "gpt-5.6",
      openAiClient: mockClient(create),
    });
    await executor.execute({
      messages: [{ role: "user", content: "hi" }],
      tools: [tool],
      context: context(),
    });
    const request = create.mock.calls[0][0] as OpenAiCompletionsRequest;
    expect(request.reasoning_effort).toBeUndefined();
  });

  it("uses an explicit reasoningEffort when tools are present", async () => {
    const create = createMock();
    const executor = new OpenAiChatExecutor({
      modelId: "gpt-5.6",
      reasoningEffort: "low",
      openAiClient: mockClient(create),
    });
    await executor.execute({
      messages: [{ role: "user", content: "hi" }],
      tools: [tool],
      context: context(),
    });
    const request = create.mock.calls[0][0] as OpenAiCompletionsRequest;
    expect(request.reasoning_effort).toBe("low");
  });
});
