import {
  Attachment,
  AttachmentFormatter,
} from "@jbcbdse/charlie-core";
import type { ContentBlock } from "@aws-sdk/client-bedrock-runtime";

const IMAGE_FORMATS: Record<string, "jpeg" | "png" | "gif" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const DOCUMENT_FORMATS: Record<
  string,
  "pdf" | "csv" | "doc" | "docx" | "xls" | "xlsx" | "html" | "txt" | "md"
> = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/html": "html",
  "text/plain": "txt",
  "text/markdown": "md",
};

let documentSeq = 0;

function documentName(): string {
  documentSeq += 1;
  return `document${documentSeq}`;
}

export function toBedrockContentBlocks(
  text: string,
  attachments: Attachment[] | undefined,
  formatter: AttachmentFormatter,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const unsupported: Attachment[] = [];
  for (const attachment of attachments ?? []) {
    const mime = attachment.mimeType.toLowerCase();
    const imageFormat = IMAGE_FORMATS[mime];
    if (imageFormat) {
      blocks.push({
        image: {
          format: imageFormat,
          source: { bytes: formatter.bytes(attachment) },
        },
      });
      continue;
    }
    const documentFormat = DOCUMENT_FORMATS[mime];
    if (documentFormat) {
      blocks.push({
        document: {
          format: documentFormat,
          name: documentName(),
          source: { bytes: formatter.bytes(attachment) },
        },
      });
      continue;
    }
    unsupported.push(attachment);
  }
  const withPlaceholders = formatter.textWithUnsupported(text, unsupported);
  if (withPlaceholders) {
    blocks.unshift({ text: withPlaceholders });
  } else if (blocks.length === 0) {
    blocks.push({ text });
  }
  return blocks;
}

export function mimeTypeFromBedrockImageFormat(
  format: string | undefined,
): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "gif") return "image/gif";
  if (format === "webp") return "image/webp";
  if (format && format.toLowerCase().startsWith("image/")) return format;
  return "application/octet-stream";
}
