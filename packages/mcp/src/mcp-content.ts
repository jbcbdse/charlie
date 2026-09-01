import type { Attachment, ChatMessage } from "@jbcbdse/charlie-core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function attachmentFromBlock(
  block: Record<string, unknown>,
): Attachment | undefined {
  const data = typeof block.data === "string" ? block.data : undefined;
  const blob =
    isRecord(block.resource) && typeof block.resource.blob === "string"
      ? block.resource.blob
      : undefined;
  const payload = data ?? blob;
  if (!payload) return undefined;
  const mimeType =
    (typeof block.mimeType === "string" && block.mimeType) ||
    (isRecord(block.resource) &&
      typeof block.resource.mimeType === "string" &&
      block.resource.mimeType) ||
    "application/octet-stream";
  const name =
    typeof block.name === "string"
      ? block.name
      : isRecord(block.resource) && typeof block.resource.uri === "string"
        ? block.resource.uri
        : undefined;
  return name ? { mimeType, data: payload, name } : { mimeType, data: payload };
}

function flattenBlock(block: unknown): string {
  if (typeof block === "string") {
    return block;
  }
  if (!isRecord(block)) {
    return JSON.stringify(block);
  }
  const type = block.type;
  if (type === "text" && typeof block.text === "string") {
    return block.text;
  }
  if (type === "image") {
    const mime = typeof block.mimeType === "string" ? block.mimeType : "image";
    return `[image ${mime}]`;
  }
  if (type === "audio") {
    const mime = typeof block.mimeType === "string" ? block.mimeType : "audio";
    return `[audio ${mime}]`;
  }
  if (type === "resource_link" && typeof block.uri === "string") {
    return `[resource ${block.uri}]`;
  }
  if (type === "resource" && isRecord(block.resource)) {
    const inner = block.resource;
    if (typeof inner.text === "string") {
      return inner.text;
    }
    if (typeof inner.uri === "string") {
      return `[resource ${inner.uri}]`;
    }
  }
  return JSON.stringify(block);
}

export function mcpContentToCharlie(content: unknown): {
  content: string;
  attachments?: Attachment[];
} {
  const blocks = Array.isArray(content)
    ? content
    : content === undefined || content === null
      ? []
      : [content];
  const texts: string[] = [];
  const attachments: Attachment[] = [];
  for (const block of blocks) {
    if (typeof block === "string") {
      texts.push(block);
      continue;
    }
    if (!isRecord(block)) {
      texts.push(JSON.stringify(block));
      continue;
    }
    const attachment = attachmentFromBlock(block);
    if (
      attachment &&
      (block.type === "image" ||
        block.type === "audio" ||
        block.type === "resource")
    ) {
      attachments.push(attachment);
      continue;
    }
    const text = flattenBlock(block);
    if (text) texts.push(text);
  }
  return attachments.length
    ? { content: texts.join("\n"), attachments }
    : { content: texts.join("\n") };
}

/**
 * Flatten MCP content blocks into a string. Images with bytes become
 * placeholders here; use {@link mcpContentToCharlie} to keep attachments.
 */
export function flattenMcpContent(content: unknown): string {
  if (content === undefined || content === null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(flattenBlock).filter(Boolean).join("\n");
  }
  return flattenBlock(content);
}

export function mcpPromptToChatMessages(messages: unknown[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }
    const role = message.role === "assistant" ? "assistant" : "user";
    const { content, attachments } = mcpContentToCharlie(message.content);
    result.push(
      attachments ? { role, content, attachments } : { role, content },
    );
  }
  return result;
}
