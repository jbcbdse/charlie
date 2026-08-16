import type { ChatMessage } from "@jbcbdse/charlie-core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

/**
 * Flatten MCP content blocks (tool results, prompt content, resource bodies)
 * into a string Charlie can store on a message or tool result.
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
    result.push({
      role,
      content: flattenMcpContent(message.content),
    });
  }
  return result;
}
