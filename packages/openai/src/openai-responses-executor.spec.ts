import OpenAI from "openai";
import { ChatExecutorInput, EventName } from "@jbcbdse/charlie-core";
import { OpenAiResponsesExecutor } from "./openai-responses-executor";

function context(): ChatExecutorInput["context"] {
  return {
    runId: "run",
    modelId: "gpt-5.4",
    messages: [],
    meta: {},
    eventProducer: { emit: jest.fn() },
  } as unknown as ChatExecutorInput["context"];
}

describe("OpenAiResponsesExecutor", () => {
  it("sends store:false, encrypted reasoning include, and mapped input items", async () => {
    const create = jest.fn().mockResolvedValue({
      output: [
        {
          type: "reasoning",
          id: "rsn_1",
          encrypted_content: "enc",
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "4" }],
        },
      ],
      output_text: "4",
      usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
    });
    const executor = new OpenAiResponsesExecutor({
      modelId: "gpt-5.4",
      openAiClient: { responses: { create } } as unknown as OpenAI,
    });
    const result = await executor.execute({
      context: context(),
      messages: [
        { role: "user", content: "2+2" },
        {
          role: "reasoning",
          id: "rsn_0",
          encryptedContent: "prev",
        },
        { role: "reasoning", content: "anthropic-only" },
        { role: "reasoning", encryptedContent: "no-id" },
        {
          role: "tool_call",
          toolCalls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "calc", arguments: { expr: "2+2" } },
            },
          ],
        },
        {
          role: "tool",
          name: "calc",
          toolCallId: "call_1",
          content: "4",
          returnDirect: false,
          status: "success",
        },
      ],
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        store: false,
        include: ["reasoning.encrypted_content"],
        input: [
          { role: "user", content: "2+2" },
          {
            type: "reasoning",
            id: "rsn_0",
            summary: [],
            encrypted_content: "prev",
          },
          {
            type: "function_call",
            call_id: "call_1",
            name: "calc",
            arguments: '{"expr":"2+2"}',
          },
          {
            type: "function_call_output",
            call_id: "call_1",
            output: "4",
          },
        ],
      }),
    );
    expect(result.responseMessages).toEqual([
      { role: "reasoning", id: "rsn_1", encryptedContent: "enc" },
      { role: "assistant", content: "4" },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 1,
      totalTokens: 4,
    });
  });

  it("groups consecutive function_call items and emits raw events", async () => {
    const emit = jest.fn();
    const create = jest.fn().mockResolvedValue({
      output: [
        {
          type: "function_call",
          call_id: "c1",
          name: "a",
          arguments: '{"x":1}',
        },
        {
          type: "function_call",
          call_id: "c2",
          name: "b",
          arguments: "not-json",
        },
      ],
      output_text: "",
    });
    const executor = new OpenAiResponsesExecutor({
      modelId: "gpt-5.4",
      openAiClient: { responses: { create } } as unknown as OpenAI,
    });
    const result = await executor.execute({
      context: {
        ...context(),
        eventProducer: { emit },
      } as unknown as ChatExecutorInput["context"],
      messages: [{ role: "user", content: "go" }],
      tools: [
        {
          name: "a",
          description: "A",
          jsonSchema: { type: "object" },
          handle: jest.fn(),
        },
      ],
    });
    expect(emit).toHaveBeenCalledWith(
      EventName.ChatRawRequest,
      expect.objectContaining({ modelId: "gpt-5.4" }),
    );
    expect(result.responseMessages).toEqual([
      {
        role: "tool_call",
        toolCalls: [
          {
            id: "c1",
            type: "function",
            function: { name: "a", arguments: { x: 1 } },
          },
          {
            id: "c2",
            type: "function",
            function: { name: "b", arguments: {} },
          },
        ],
      },
    ]);
  });
});
