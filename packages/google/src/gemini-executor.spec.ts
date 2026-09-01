import { EventName, EventProducer } from "@jbcbdse/charlie-core";
import { GeminiExecutor } from "./gemini-executor";

describe("GeminiExecutor streaming", () => {
  it("falls back to an empty assistant message when the candidate has no parts", async () => {
    const producer = new EventProducer();
    const generateContentStream = jest.fn().mockResolvedValue({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { candidates: [{ content: { parts: [] } }] };
        },
      },
      response: Promise.resolve({
        candidates: [{ content: { role: "model", parts: [] } }],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 2,
          thoughtsTokenCount: 3,
          totalTokenCount: 6,
        },
      }),
    });
    const executor = new GeminiExecutor({
      modelId: "gemini-test",
      apiKey: "test",
    });
    (
      executor as unknown as { model: { generateContentStream: unknown } }
    ).model = { generateContentStream };
    const result = await executor.execute({
      messages: [{ role: "user", content: "hi" }],
      context: {
        runId: "run-1",
        modelId: "gemini-test",
        messages: [],
        tools: [],
        mustCallTool: false,
        meta: {},
        eventProducer: producer,
      },
    });
    expect(result.responseMessages).toEqual([
      { role: "assistant", content: "" },
    ]);
    expect(result.responseMessage).toEqual({
      role: "assistant",
      content: "",
    });
    expect(result.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 6,
      reasoningTokens: 3,
    });
    expect(producer.emitter.listenerCount(EventName.ChatStreamChunk)).toBe(0);
  });

  it("maps required toolChoice to functionCallingConfig ANY", async () => {
    const generateContentStream = jest.fn().mockResolvedValue({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { candidates: [{ content: { parts: [{ text: "ok" }] } }] };
        },
      },
      response: Promise.resolve({
        candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
      }),
    });
    const executor = new GeminiExecutor({
      modelId: "gemini-test",
      apiKey: "test",
    });
    (
      executor as unknown as { model: { generateContentStream: unknown } }
    ).model = { generateContentStream };
    await executor.execute({
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "ping",
          description: "ping",
          jsonSchema: { type: "object", properties: {} },
          handle: async () => "pong",
        },
      ],
      toolChoice: { type: "required" },
      context: {
        runId: "run-1",
        modelId: "gemini-test",
        messages: [],
        tools: [],
        mustCallTool: false,
        meta: {},
        eventProducer: new EventProducer(),
      },
    });
    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: {
          functionCallingConfig: { mode: "ANY" },
        },
      }),
    );
  });

  it("maps named toolChoice to ANY with allowedFunctionNames", async () => {
    const generateContentStream = jest.fn().mockResolvedValue({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { candidates: [{ content: { parts: [{ text: "ok" }] } }] };
        },
      },
      response: Promise.resolve({
        candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
      }),
    });
    const executor = new GeminiExecutor({
      modelId: "gemini-test",
      apiKey: "test",
    });
    (
      executor as unknown as { model: { generateContentStream: unknown } }
    ).model = { generateContentStream };
    await executor.execute({
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "ping",
          description: "ping",
          jsonSchema: { type: "object", properties: {} },
          handle: async () => "pong",
        },
      ],
      toolChoice: { type: "tool", name: "ping" },
      context: {
        runId: "run-1",
        modelId: "gemini-test",
        messages: [],
        tools: [],
        mustCallTool: false,
        meta: {},
        eventProducer: new EventProducer(),
      },
    });
    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: ["ping"],
          },
        },
      }),
    );
  });

  it("maps streamed inlineData onto assistant attachments", async () => {
    const generateContentStream = jest.fn().mockResolvedValue({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield {
            candidates: [
              {
                content: {
                  parts: [
                    { text: "see" },
                    { inlineData: { mimeType: "image/png", data: "AAAA" } },
                  ],
                },
              },
            ],
          };
        },
      },
      response: Promise.resolve({}),
    });
    const executor = new GeminiExecutor({
      modelId: "gemini-test",
      apiKey: "test",
    });
    (
      executor as unknown as { model: { generateContentStream: unknown } }
    ).model = { generateContentStream };
    const result = await executor.execute({
      messages: [
        {
          role: "user",
          content: "look",
          attachments: [{ mimeType: "image/png", data: "BBBB" }],
        },
      ],
      context: {
        runId: "run-1",
        modelId: "gemini-test",
        messages: [],
        tools: [],
        mustCallTool: false,
        meta: {},
        eventProducer: new EventProducer(),
      },
    });
    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          {
            role: "user",
            parts: [
              { text: "look" },
              { inlineData: { mimeType: "image/png", data: "BBBB" } },
            ],
          },
        ],
      }),
    );
    expect(result.responseMessages).toEqual([
      {
        role: "assistant",
        content: "see",
        attachments: [{ mimeType: "image/png", data: "AAAA" }],
      },
    ]);
  });
});
