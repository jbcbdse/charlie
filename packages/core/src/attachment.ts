import { Attachment } from "./types";

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

export function attachmentPlaceholder(attachment: Attachment): string {
  return `[attachment ${attachment.mimeType}]`;
}

export function attachmentBase64(attachment: Attachment): string {
  if (typeof attachment.data === "string") {
    return attachment.data;
  }
  return Buffer.from(attachment.data).toString("base64");
}

export function attachmentBytes(attachment: Attachment): Uint8Array {
  if (typeof attachment.data !== "string") {
    return attachment.data;
  }
  return Uint8Array.from(Buffer.from(attachment.data, "base64"));
}

export function attachmentDataUrl(attachment: Attachment): string {
  return `data:${attachment.mimeType};base64,${attachmentBase64(attachment)}`;
}

/**
 * Append placeholders for attachments the vendor cannot send as native blocks.
 */
export function textWithUnsupportedAttachments(
  text: string,
  unsupported: Attachment[],
): string {
  if (unsupported.length === 0) {
    return text;
  }
  return [text, ...unsupported.map(attachmentPlaceholder)]
    .filter(Boolean)
    .join("\n");
}

export function messageTextWithPlaceholders(msg: {
  content: string;
  attachments?: Attachment[];
}): string {
  return textWithUnsupportedAttachments(msg.content, msg.attachments ?? []);
}
