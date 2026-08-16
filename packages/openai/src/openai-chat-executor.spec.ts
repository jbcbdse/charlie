import { EventName, EventProducer, StreamChunk } from "@jbcbdse/charlie-core";
import { OpenAiChatExecutor } from "./openai-chat-executor";

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
    meta: {},
    eventProducer: producer,
  };
}

describe("OpenAiChatExecutor streaming", () => {
  it("merges two text slices into assistant content", async () => {
    const producer = new EventProducer();
    const chunks: StreamChunk[] = [];
    producer.emitter.on(EventName.ChatStreamChunk, (event) => {
      chunks.push(event.chunk);
    });
    const create = jest.fn().mockResolvedValue(
      asyncChunks([
        { choices: [{ delta: { content: "Hel" } }] },
        { choices: [{ delta: { content: "lo" } }] },
        {
          choices: [{ delta: {} }],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3,
            completion_tokens_details: { reasoning_tokens: 4 },
          },
        },
      ]),
    );
    const executor = new OpenAiChatExecutor({
      modelId: "test-model",
      openAiClient: {
        chat: { completions: { create } },
      } as never,
    });
    const result = await executor.execute({
      messages: [{ role: "user", content: "hi" }],
      context: context(producer),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        stream_options: { include_usage: true },
      }),
    );
    expect(result.responseMessage).toEqual({
      role: "assistant",
      content: "Hello",
    });
    expect(result.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      reasoningTokens: 4,
    });
    expect(chunks).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
    ]);
  });

  it("merges a tool call split across chunks", async () => {
    const producer = new EventProducer();
    const create = jest.fn().mockResolvedValue(
      asyncChunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    function: { name: "CalculatorTool", arguments: "" },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"expr"' } }],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: ':"1+1"}' } }],
              },
            },
          ],
        },
      ]),
    );
    const executor = new OpenAiChatExecutor({
      modelId: "test-model",
      openAiClient: {
        chat: { completions: { create } },
      } as never,
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

  it("keeps parallel tool calls that omit index but have distinct ids", async () => {
    const producer = new EventProducer();
    const create = jest.fn().mockResolvedValue(
      asyncChunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    id: "c1",
                    function: { name: "A", arguments: "{}" },
                  },
                  {
                    id: "c2",
                    function: { name: "B", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );
    const executor = new OpenAiChatExecutor({
      modelId: "test-model",
      openAiClient: {
        chat: { completions: { create } },
      } as never,
    });
    const result = await executor.execute({
      messages: [{ role: "user", content: "go" }],
      context: context(producer),
    });
    expect(result.responseMessage).toEqual({
      role: "tool_call",
      toolCalls: [
        {
          id: "c1",
          type: "function",
          function: { name: "A", arguments: {} },
        },
        {
          id: "c2",
          type: "function",
          function: { name: "B", arguments: {} },
        },
      ],
    });
  });

  it("keeps streamed preamble text when a tool call follows", async () => {
    const producer = new EventProducer();
    const create = jest.fn().mockResolvedValue(
      asyncChunks([
        { choices: [{ delta: { content: "Let me check. " } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "c1",
                    function: { name: "CalculatorTool", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );
    const executor = new OpenAiChatExecutor({
      modelId: "test-model",
      openAiClient: {
        chat: { completions: { create } },
      } as never,
    });
    const result = await executor.execute({
      messages: [{ role: "user", content: "calc" }],
      context: context(producer),
    });
    expect(result.responseMessages).toEqual([
      { role: "assistant", content: "Let me check. " },
      {
        role: "tool_call",
        toolCalls: [
          {
            id: "c1",
            type: "function",
            function: { name: "CalculatorTool", arguments: {} },
          },
        ],
      },
    ]);
  });

  it("emits reasoning_content as thinking and keeps it out of assistant content", async () => {
    const producer = new EventProducer();
    const chunks: StreamChunk[] = [];
    producer.emitter.on(EventName.ChatStreamChunk, (event) => {
      chunks.push(event.chunk);
    });
    const create = jest
      .fn()
      .mockResolvedValue(
        asyncChunks([
          { choices: [{ delta: { reasoning_content: "ponder" } }] },
          { choices: [{ delta: { content: "42" } }] },
        ]),
      );
    const executor = new OpenAiChatExecutor({
      modelId: "test-model",
      openAiClient: {
        chat: { completions: { create } },
      } as never,
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
