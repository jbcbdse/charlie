import { CharlieStreamConsumer } from "./charlie-stream";
import { EventName, EventProducer, StreamChunk } from "./event-producer";
import { ChatAgentContext } from "./types";

function context(producer: EventProducer): ChatAgentContext {
  return {
    runId: "run-1",
    modelId: "test-model",
    messages: [],
    tools: [],
    meta: {},
    eventProducer: producer,
  };
}

function consume(
  producer: EventProducer,
  parts: Parameters<CharlieStreamConsumer["consume"]>[0],
) {
  return new CharlieStreamConsumer(context(producer), {
    modelId: "m",
    modelProvider: "p",
  }).consume(parts);
}

describe("CharlieStreamConsumer", () => {
  it("merges text, emits chunks, and keeps thinking out of assistant content", async () => {
    const producer = new EventProducer();
    const chunks: StreamChunk[] = [];
    producer.emitter.on(EventName.ChatStreamChunk, (event) => {
      chunks.push(event.chunk);
    });
    const result = await consume(producer, [
      { type: "thinking", text: "ponder" },
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      {
        type: "usage",
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        reasoningTokens: 4,
      },
    ]);
    expect(chunks).toEqual([
      { type: "thinking", text: "ponder" },
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
    ]);
    expect(result.responseMessages).toEqual([
      { role: "assistant", content: "Hello" },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      reasoningTokens: 4,
    });
  });

  it("merges tool_call slices and persists reasoning", async () => {
    const producer = new EventProducer();
    const result = await consume(producer, [
      {
        type: "reasoning",
        id: "rsn_1",
        encryptedContent: "enc",
      },
      {
        type: "tool_call",
        index: 0,
        id: "c1",
        name: "calc",
      },
      { type: "tool_call", index: 0, argumentsText: '{"x":' },
      { type: "tool_call", index: 0, argumentsText: "1}" },
    ]);
    expect(result.responseMessages).toEqual([
      { role: "reasoning", id: "rsn_1", encryptedContent: "enc" },
      {
        role: "tool_call",
        toolCalls: [
          {
            id: "c1",
            type: "function",
            function: { name: "calc", arguments: { x: 1 } },
          },
        ],
      },
    ]);
    expect(result.responseMessage.role).toBe("tool_call");
  });

  it("throws yielded errors and falls back to an empty assistant", async () => {
    const producer = new EventProducer();
    await expect(
      consume(producer, [{ type: "error", error: new Error("boom") }]),
    ).rejects.toThrow("boom");
    const empty = await consume(producer, []);
    expect(empty.responseMessages).toEqual([
      { role: "assistant", content: "" },
    ]);
  });
});
