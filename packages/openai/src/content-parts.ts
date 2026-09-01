import {
  Attachment,
  AttachmentFormatter,
} from "@jbcbdse/charlie-core";

export type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename?: string; file_data: string } };

function isOpenAiFileMime(mimeType: string): boolean {
  return mimeType.toLowerCase() === "application/pdf";
}

export function isOpenAiNativeMime(
  mimeType: string,
  formatter: AttachmentFormatter,
): boolean {
  return formatter.isImageMimeType(mimeType) || isOpenAiFileMime(mimeType);
}

export function toOpenAiContent(
  text: string,
  attachments: Attachment[] | undefined,
  formatter: AttachmentFormatter,
): string | OpenAiContentPart[] {
  if (!attachments?.length) {
    return text;
  }
  const parts: OpenAiContentPart[] = [];
  const unsupported: Attachment[] = [];
  for (const attachment of attachments) {
    if (formatter.isImageMimeType(attachment.mimeType)) {
      parts.push({
        type: "image_url",
        image_url: { url: formatter.dataUrl(attachment) },
      });
    } else if (isOpenAiFileMime(attachment.mimeType)) {
      parts.push({
        type: "file",
        file: {
          filename: attachment.name ?? "file.pdf",
          file_data: formatter.dataUrl(attachment),
        },
      });
    } else {
      unsupported.push(attachment);
    }
  }
  const withPlaceholders = formatter.textWithUnsupported(text, unsupported);
  if (withPlaceholders) {
    parts.unshift({ type: "text", text: withPlaceholders });
  }
  return parts;
}

export type ResponsesInputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" }
  | { type: "input_file"; filename: string; file_data: string };

export function toResponsesContent(
  text: string,
  attachments: Attachment[] | undefined,
  formatter: AttachmentFormatter,
): string | ResponsesInputPart[] {
  if (!attachments?.length) {
    return text;
  }
  const parts: ResponsesInputPart[] = [];
  const unsupported: Attachment[] = [];
  for (const attachment of attachments) {
    if (formatter.isImageMimeType(attachment.mimeType)) {
      parts.push({
        type: "input_image",
        image_url: formatter.dataUrl(attachment),
        detail: "auto",
      });
    } else if (isOpenAiFileMime(attachment.mimeType)) {
      parts.push({
        type: "input_file",
        filename: attachment.name ?? "file.pdf",
        file_data: formatter.dataUrl(attachment),
      });
    } else {
      unsupported.push(attachment);
    }
  }
  const withPlaceholders = formatter.textWithUnsupported(text, unsupported);
  if (withPlaceholders) {
    parts.unshift({ type: "input_text", text: withPlaceholders });
  }
  return parts;
}

export function parseDataUrl(
  url: string,
): { mimeType: string; data: string } | undefined {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
  if (!match) return undefined;
  return { mimeType: match[1], data: match[2] };
}
