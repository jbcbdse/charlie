import { EventName, StreamChunk } from "@jbcbdse/charlie-core";
import { BedrockMantleMessagesExecutor } from "./bedrock-mantle-messages-executor";

function context(emit = jest.fn()) {
  return {
    runId: "run",
    modelId: "anthropic.claude-haiku-4-5",
    messages: [],
    tools: [],
    mustCallTool: false,
    meta: {},
    eventProducer: { emit },
  };
}

describe("BedrockMantleMessagesExecutor streaming", () => {
  it("emits thinking and text and stores signed reasoning", async () => {
    const emit = jest.fn();
    const create = jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "ponder" },
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
          delta: { type: "text_delta", text: "4" },
        };
      },
    });
    const executor = new BedrockMantleMessagesExecutor({
      anthropicClient: { messages: { create } } as never,
    });
    const result = await executor.execute({
      context: context(emit) as never,
      messages: [{ role: "user", content: "why" }],
    });
    const chunks = emit.mock.calls
      .filter((call) => call[0] === EventName.ChatStreamChunk)
      .map((call) => call[1].chunk as StreamChunk);
    expect(chunks).toEqual([
      { type: "thinking", text: "ponder" },
      { type: "text", text: "4" },
    ]);
    expect(result.responseMessages).toEqual([
      { role: "reasoning", content: "ponder", signature: "sig" },
      { role: "assistant", content: "4" },
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
    );
  });

  it("maps required toolChoice to tool_choice any", async () => {
    const create = jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "ok" },
        };
      },
    });
    const executor = new BedrockMantleMessagesExecutor({
      anthropicClient: { messages: { create } } as never,
    });
    await executor.execute({
      context: context() as never,
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "ping",
          description: "ping",
          jsonSchema: { type: "object" },
          handle: async () => "pong",
        },
      ],
      toolChoice: { type: "required" },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ tool_choice: { type: "any" } }),
    );
  });

  it("maps named toolChoice to tool_choice tool", async () => {
    const create = jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "ok" },
        };
      },
    });
    const executor = new BedrockMantleMessagesExecutor({
      anthropicClient: { messages: { create } } as never,
    });
    await executor.execute({
      context: context() as never,
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "ping",
          description: "ping",
          jsonSchema: { type: "object" },
          handle: async () => "pong",
        },
      ],
      toolChoice: { type: "tool", name: "ping" },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "tool", name: "ping" },
      }),
    );
  });
});
