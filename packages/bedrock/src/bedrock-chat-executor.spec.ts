import { EventName, EventProducer, StreamChunk } from "@jbcbdse/charlie-core";
import { BedrockChatExecutor } from "./bedrock-chat-executor";

function asyncChunks<T>(parts: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) {
        yield part;
      }
    },
  };
}

function context(producer: EventProducer) {
  return {
    runId: "run-1",
    modelId: "test-model",
    messages: [],
    tools: [],
    meta: {},
    eventProducer: producer,
  };
}

describe("BedrockChatExecutor streaming", () => {
  it("merges two text slices into assistant content", async () => {
    const producer = new EventProducer();
    const chunks: StreamChunk[] = [];
    producer.emitter.on(EventName.ChatStreamChunk, (event) => {
      chunks.push(event.chunk);
    });
    const converseStream = jest.fn().mockResolvedValue({
      stream: asyncChunks([
        { contentBlockDelta: { delta: { text: "Hel" } } },
        { contentBlockDelta: { delta: { text: "lo" } } },
        {
          metadata: {
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          },
        },
      ]),
    });
    const executor = new BedrockChatExecutor({
      modelId: "anthropic.claude-test",
      client: { converseStream } as never,
    });
    const result = await executor.execute({
      messages: [{ role: "user", content: "hi" }],
      context: context(producer),
    });
    expect(result.responseMessage).toEqual({
      role: "assistant",
      content: "Hello",
    });
    expect(result.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
    expect(chunks).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
    ]);
  });

  it("merges a tool call split across start and input chunks", async () => {
    const producer = new EventProducer();
    const converseStream = jest.fn().mockResolvedValue({
      stream: asyncChunks([
        {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: "call-1", name: "CalculatorTool" } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: '{"expr"' } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: ':"1+1"}' } },
          },
        },
      ]),
    });
    const executor = new BedrockChatExecutor({
      modelId: "anthropic.claude-test",
      client: { converseStream } as never,
    });
    const result = await executor.execute({
      messages: [{ role: "user", content: "calc" }],
      context: context(producer),
    });
    expect(result.responseMessage).toEqual({
      role: "tool_call",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "CalculatorTool", arguments: { expr: "1+1" } },
        },
      ],
    });
  });

  it("falls back to converse when the model rejects tools on converseStream", async () => {
    const producer = new EventProducer();
    const chunks: StreamChunk[] = [];
    producer.emitter.on(EventName.ChatStreamChunk, (event) => {
      chunks.push(event.chunk);
    });
    const converseStream = jest
      .fn()
      .mockRejectedValue(
        new Error("This model doesn't support tool use in streaming mode."),
      );
    const converse = jest.fn().mockResolvedValue({
      output: {
        message: {
          content: [{ text: "PONG" }],
        },
      },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const executor = new BedrockChatExecutor({
      modelId: "us.meta.llama4-scout-17b-instruct-v1:0",
      client: { converseStream, converse } as never,
    });
    const result = await executor.execute({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "CalculatorTool",
          description: "calc",
          jsonSchema: { type: "object" },
          handle: async () => "ok",
        },
      ],
      context: context(producer),
    });
    expect(converse).toHaveBeenCalled();
    expect(result.responseMessage).toEqual({
      role: "assistant",
      content: "PONG",
    });
    expect(chunks).toEqual([{ type: "text", text: "PONG" }]);
  });

  it("does not fall back after the stream has already started", async () => {
    const producer = new EventProducer();
    const converse = jest.fn();
    const converseStream = jest.fn().mockResolvedValue({
      stream: (async function* () {
        yield { contentBlockDelta: { delta: { text: "partial" } } };
        throw new Error(
          "This model doesn't support tool use in streaming mode.",
        );
      })(),
    });
    const executor = new BedrockChatExecutor({
      modelId: "us.meta.llama4-scout-17b-instruct-v1:0",
      client: { converseStream, converse } as never,
    });
    await expect(
      executor.execute({
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            name: "CalculatorTool",
            description: "calc",
            jsonSchema: { type: "object" },
            handle: async () => "ok",
          },
        ],
        context: context(producer),
      }),
    ).rejects.toThrow(/streaming mode/);
    expect(converse).not.toHaveBeenCalled();
  });

  it("emits reasoningContent as thinking and keeps it out of assistant content", async () => {
    const producer = new EventProducer();
    const chunks: StreamChunk[] = [];
    producer.emitter.on(EventName.ChatStreamChunk, (event) => {
      chunks.push(event.chunk);
    });
    const converseStream = jest.fn().mockResolvedValue({
      stream: asyncChunks([
        {
          contentBlockDelta: {
            delta: { reasoningContent: { text: "ponder" } },
          },
        },
        {
          contentBlockDelta: {
            delta: { reasoningContent: { signature: "sig" } },
          },
        },
        { contentBlockDelta: { delta: { text: "42" } } },
      ]),
    });
    const executor = new BedrockChatExecutor({
      modelId: "anthropic.claude-test",
      client: { converseStream } as never,
    });
    const result = await executor.execute({
      messages: [{ role: "user", content: "why" }],
      context: context(producer),
    });
    expect(chunks).toEqual([
      { type: "thinking", text: "ponder" },
      { type: "text", text: "42" },
    ]);
    expect(result.responseMessage).toEqual({
      role: "assistant",
      content: "42",
    });
  });
});
