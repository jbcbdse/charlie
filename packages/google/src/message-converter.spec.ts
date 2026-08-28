import { Content } from "@google/generative-ai";
import { MessageConverter } from "./message-converter";

describe("MessageConverter.responseContentChatMessages", () => {
  const converter = new MessageConverter();

  it("merges consecutive streamed text parts into one assistant message", () => {
    const content = {
      role: "model",
      parts: [{ text: "Hel" }, { text: "lo" }],
    } as Content;
    expect(converter.responseContentChatMessages(content)).toEqual([
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("drops thought parts and returns no messages when only thoughts remain", () => {
    const content = {
      role: "model",
      parts: [{ thought: true, text: "ponder" }],
    } as unknown as Content;
    expect(converter.responseContentChatMessages(content)).toEqual([]);
  });

  it("maps user image attachments to inlineData", () => {
    expect(
      converter.toContent({
        role: "user",
        content: "look",
        attachments: [{ mimeType: "image/png", data: "AAAA" }],
      }),
    ).toEqual({
      role: "user",
      parts: [
        { text: "look" },
        { inlineData: { mimeType: "image/png", data: "AAAA" } },
      ],
    });
  });

  it("folds inlineData onto assistant attachments", () => {
    const content = {
      role: "model",
      parts: [
        { text: "see" },
        { inlineData: { mimeType: "image/png", data: "AAAA" } },
      ],
    } as Content;
    expect(converter.responseContentChatMessages(content)).toEqual([
      {
        role: "assistant",
        content: "see",
        attachments: [{ mimeType: "image/png", data: "AAAA" }],
      },
    ]);
  });
});
