import { parseDataUrl, toOpenAiContent, toResponsesContent } from "./content-parts";

const pngB64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("toOpenAiContent", () => {
  it("keeps plain text when there are no attachments", () => {
    expect(toOpenAiContent("hello")).toBe("hello");
  });

  it("maps image attachments to image_url data URLs", () => {
    expect(
      toOpenAiContent("look", [
        { mimeType: "image/png", data: pngB64, name: "dot.png" },
      ]),
    ).toEqual([
      { type: "text", text: "look" },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${pngB64}` },
      },
    ]);
  });

  it("appends placeholders for unsupported MIME types", () => {
    expect(
      toOpenAiContent("hi", [{ mimeType: "audio/wav", data: "AAAA" }]),
    ).toEqual([{ type: "text", text: "hi\n[attachment audio/wav]" }]);
  });
});

describe("toResponsesContent", () => {
  it("maps image attachments to input_image", () => {
    expect(
      toResponsesContent("look", [{ mimeType: "image/png", data: pngB64 }]),
    ).toEqual([
      { type: "input_text", text: "look" },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${pngB64}`,
        detail: "auto",
      },
    ]);
  });
});

describe("parseDataUrl", () => {
  it("parses a data URL and rejects remote URLs", () => {
    expect(parseDataUrl(`data:image/jpeg;base64,${pngB64}`)).toEqual({
      mimeType: "image/jpeg",
      data: pngB64,
    });
    expect(parseDataUrl("https://example.com/a.png")).toBeUndefined();
  });
});
