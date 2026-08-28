import {
  flattenMcpContent,
  mcpContentToCharlie,
  mcpPromptToChatMessages,
} from "./mcp-content";

describe("flattenMcpContent", () => {
  it("joins text blocks", () => {
    expect(
      flattenMcpContent([
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ]),
    ).toBe("hello\nworld");
  });

  it("describes image, audio, and resource links", () => {
    expect(
      flattenMcpContent([
        { type: "image", mimeType: "image/png" },
        { type: "audio", mimeType: "audio/wav" },
        { type: "resource_link", uri: "file:///tmp/a" },
      ]),
    ).toBe("[image image/png]\n[audio audio/wav]\n[resource file:///tmp/a]");
  });

  it("unwraps embedded resource text", () => {
    expect(
      flattenMcpContent({
        type: "resource",
        resource: { uri: "demo://x", text: "body" },
      }),
    ).toBe("body");
  });
});

describe("mcpContentToCharlie", () => {
  it("keeps image bytes as attachments", () => {
    expect(
      mcpContentToCharlie([
        { type: "text", text: "see" },
        { type: "image", mimeType: "image/png", data: "AAAA" },
      ]),
    ).toEqual({
      content: "see",
      attachments: [{ mimeType: "image/png", data: "AAAA" }],
    });
  });
});

describe("mcpPromptToChatMessages", () => {
  it("maps user and assistant prompt messages", () => {
    expect(
      mcpPromptToChatMessages([
        {
          role: "user",
          content: { type: "text", text: "Review this" },
        },
        {
          role: "assistant",
          content: { type: "text", text: "ok" },
        },
      ]),
    ).toEqual([
      { role: "user", content: "Review this" },
      { role: "assistant", content: "ok" },
    ]);
  });

  it("maps prompt image blocks onto message attachments", () => {
    expect(
      mcpPromptToChatMessages([
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", mimeType: "image/png", data: "AAAA" },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "user",
        content: "look",
        attachments: [{ mimeType: "image/png", data: "AAAA" }],
      },
    ]);
  });
});
