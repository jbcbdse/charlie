import { Attachment } from "./types";

/**
 * Formats attachment bytes for vendor APIs and placeholder text.
 * Inject one instance; do not wrap a single attachment.
 */
export class AttachmentFormatter {
  public isImageMimeType(mimeType: string): boolean {
    return mimeType.toLowerCase().startsWith("image/");
  }

  public placeholder(attachment: Attachment): string {
    return `[attachment ${attachment.mimeType}]`;
  }

  public base64(attachment: Attachment): string {
    if (typeof attachment.data === "string") {
      return attachment.data;
    }
    return Buffer.from(attachment.data).toString("base64");
  }

  public bytes(attachment: Attachment): Uint8Array {
    if (typeof attachment.data !== "string") {
      return attachment.data;
    }
    return Uint8Array.from(Buffer.from(attachment.data, "base64"));
  }

  public dataUrl(attachment: Attachment): string {
    return `data:${attachment.mimeType};base64,${this.base64(attachment)}`;
  }

  /**
   * Append placeholders for attachments the vendor cannot send as native blocks.
   */
  public textWithUnsupported(
    text: string,
    unsupported: Attachment[],
  ): string {
    if (unsupported.length === 0) {
      return text;
    }
    return [text, ...unsupported.map((a) => this.placeholder(a))]
      .filter(Boolean)
      .join("\n");
  }

  public messageTextWithPlaceholders(msg: {
    content: string;
    attachments?: Attachment[];
  }): string {
    return this.textWithUnsupported(msg.content, msg.attachments ?? []);
  }
}
