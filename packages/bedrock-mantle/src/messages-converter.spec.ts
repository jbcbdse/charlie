import { MantleMessagesConverter } from "./messages-converter";

describe("MantleMessagesConverter", () => {
  const converter = new MantleMessagesConverter();

  it("round-trips thinking, text, tool_use, and tool_result", () => {
    const params = converter.toMessages([
      { role: "system", content: "ignored" },
      { role: "user", content: "add" },
      {
        role: "reasoning",
        content: "think",
        signature: "sig",
      },
      {
        role: "tool_call",
        toolCalls: [
          {
            id: "t1",
            type: "function",
            function: { name: "calc", arguments: { expr: "1+1" } },
          },
        ],
      },
      {
        role: "tool",
        name: "calc",
        toolCallId: "t1",
        content: "2",
        returnDirect: false,
        status: "success",
      },
    ]);
    expect(params).toEqual([
      { role: "user", content: "add" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "think", signature: "sig" },
          {
            type: "tool_use",
            id: "t1",
            name: "calc",
            input: { expr: "1+1" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "2",
            is_error: false,
          },
        ],
      },
    ]);
  });

  it("merges consecutive same-role turns", () => {
    expect(
      converter.toMessages([
        { role: "user", content: "one" },
        { role: "user", content: "two" },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ],
      },
    ]);
    expect(
      converter.toMessages([
        {
          role: "tool",
          name: "calc",
          toolCallId: "t1",
          content: "2",
          returnDirect: false,
          status: "success",
        },
        { role: "user", content: "thanks" },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "2",
            is_error: false,
          },
          { type: "text", text: "thanks" },
        ],
      },
    ]);
  });

  it("parses thinking, text, and tool_use from a response", () => {
    expect(
      converter.fromResponse([
        { type: "thinking", thinking: "think", signature: "sig" },
        { type: "text", text: "hi" },
        {
          type: "tool_use",
          id: "t1",
          name: "calc",
          input: { expr: "1" },
        },
      ]),
    ).toEqual([
      { role: "reasoning", content: "think", signature: "sig" },
      { role: "assistant", content: "hi" },
      {
        role: "tool_call",
        toolCalls: [
          {
            id: "t1",
            type: "function",
            function: { name: "calc", arguments: { expr: "1" } },
          },
        ],
      },
    ]);
  });

  it("maps image attachments to Anthropic image blocks", () => {
    expect(
      converter.toMessages([
        {
          role: "user",
          content: "look",
          attachments: [{ mimeType: "image/png", data: "AAAA" }],
        },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "AAAA",
            },
          },
        ],
      },
    ]);
  });

  it("folds response image blocks onto assistant attachments", () => {
    expect(
      converter.fromResponse([
        { type: "text", text: "see" },
        {
          type: "image",
          source: { media_type: "image/png", data: "AAAA" },
        },
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: "see",
        attachments: [{ mimeType: "image/png", data: "AAAA" }],
      },
    ]);
  });

  it("sends assistant attachments as text placeholders", () => {
    expect(
      converter.toMessages([
        {
          role: "assistant",
          content: "see",
          attachments: [{ mimeType: "image/png", data: "AAAA" }],
        },
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "see\n[attachment image/png]" }],
      },
    ]);
  });
});
