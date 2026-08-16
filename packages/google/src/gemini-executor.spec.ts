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
});
