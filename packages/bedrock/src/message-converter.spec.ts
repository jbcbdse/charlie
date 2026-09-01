import { MessageConverter } from "./message-converter";

const pngB64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("MessageConverter attachments", () => {
  const converter = new MessageConverter({ toolsSupported: true });

  it("maps image attachments to Bedrock image blocks", () => {
    const [message] = converter.toBedrockMessages([
      {
        role: "user",
        content: "look",
        attachments: [{ mimeType: "image/png", data: pngB64 }],
      },
    ]);
    expect(message.role).toBe("user");
    expect(message.content?.[0]).toEqual({ text: "look" });
    expect(message.content?.[1]?.image?.format).toBe("png");
    expect(message.content?.[1]?.image?.source?.bytes).toBeInstanceOf(
      Uint8Array,
    );
  });

  it("appends placeholders for unsupported MIME types", () => {
    const [message] = converter.toBedrockMessages([
      {
        role: "user",
        content: "hi",
        attachments: [{ mimeType: "audio/wav", data: "AAAA" }],
      },
    ]);
    expect(message.content).toEqual([{ text: "hi\n[attachment audio/wav]" }]);
  });

  it("uses unique alphanumeric names for document blocks", () => {
    const [message] = converter.toBedrockMessages([
      {
        role: "user",
        content: "read",
        attachments: [
          {
            mimeType: "application/pdf",
            data: "AAAA",
            name: "report.pdf",
          },
          {
            mimeType: "application/pdf",
            data: "BBBB",
            name: "other file.pdf",
          },
        ],
      },
    ]);
    expect(message.content?.[1]?.document?.name).toMatch(/^document\d+$/);
    expect(message.content?.[2]?.document?.name).toMatch(/^document\d+$/);
    expect(message.content?.[1]?.document?.name).not.toBe(
      message.content?.[2]?.document?.name,
    );
  });

  it("does not send image blocks on assistant turns", () => {
    const [message] = converter.toBedrockMessages([
      {
        role: "assistant",
        content: "see",
        attachments: [{ mimeType: "image/png", data: pngB64 }],
      },
    ]);
    expect(message.role).toBe("assistant");
    expect(message.content).toEqual([
      { text: "see\n[attachment image/png]" },
    ]);
  });
});
