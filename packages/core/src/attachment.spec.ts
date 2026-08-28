import {
  attachmentBase64,
  attachmentBytes,
  attachmentDataUrl,
  attachmentPlaceholder,
  isImageMimeType,
  textWithUnsupportedAttachments,
} from "./attachment";

const pngB64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("attachment helpers", () => {
  it("round-trips base64 and bytes", () => {
    const fromB64 = { mimeType: "image/png", data: pngB64 };
    const bytes = attachmentBytes(fromB64);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(attachmentBase64({ mimeType: "image/png", data: bytes })).toBe(
      pngB64,
    );
    expect(attachmentDataUrl(fromB64)).toBe(`data:image/png;base64,${pngB64}`);
  });

  it("builds placeholders for unsupported attachments", () => {
    const att = { mimeType: "audio/wav", data: "AAAA" };
    expect(isImageMimeType(att.mimeType)).toBe(false);
    expect(attachmentPlaceholder(att)).toBe("[attachment audio/wav]");
    expect(textWithUnsupportedAttachments("hello", [att])).toBe(
      "hello\n[attachment audio/wav]",
    );
  });
});
