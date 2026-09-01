import { AttachmentFormatter } from "./attachment";

const pngB64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("AttachmentFormatter", () => {
  const formatter = new AttachmentFormatter();

  it("round-trips base64 and bytes", () => {
    const fromB64 = { mimeType: "image/png", data: pngB64 };
    const bytes = formatter.bytes(fromB64);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(formatter.base64({ mimeType: "image/png", data: bytes })).toBe(
      pngB64,
    );
    expect(formatter.dataUrl(fromB64)).toBe(
      `data:image/png;base64,${pngB64}`,
    );
  });

  it("builds placeholders for unsupported attachments", () => {
    const att = { mimeType: "audio/wav", data: "AAAA" };
    expect(formatter.isImageMimeType(att.mimeType)).toBe(false);
    expect(formatter.placeholder(att)).toBe("[attachment audio/wav]");
    expect(formatter.textWithUnsupported("hello", [att])).toBe(
      "hello\n[attachment audio/wav]",
    );
  });
});
