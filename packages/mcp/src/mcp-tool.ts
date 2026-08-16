import type { Client } from "@modelcontextprotocol/client";
import {
  EventName,
  type ChatAgentContext,
  type ITool,
} from "@jbcbdse/charlie-core";
import { flattenMcpContent } from "./mcp-content";

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class McpTool implements ITool {
  public readonly name: string;
  public readonly description: string;
  public readonly jsonSchema: unknown;

  constructor(
    private readonly client: Client,
    private readonly definition: McpToolDefinition,
    namePrefix: string,
  ) {
    this.name = McpTool.charlieToolName(namePrefix, definition.name);
    this.description = definition.description ?? "";
    this.jsonSchema = McpTool.normalizeJsonSchema(definition.inputSchema);
  }

  public async handle(
    params: unknown,
    context: ChatAgentContext,
  ): Promise<string> {
    const result = await this.client.callTool(
      {
        name: this.definition.name,
        arguments:
          params && typeof params === "object"
            ? (params as Record<string, unknown>)
            : {},
      },
      {
        onprogress: (update) => {
          const message =
            update.message ?? `${update.progress}/${update.total ?? "?"}`;
          context.eventProducer.emit(EventName.ToolProgress, {
            context,
            message,
          });
        },
        resetTimeoutOnProgress: true,
      },
    );
    let text = flattenMcpContent(result.content);
    if (!text && result.structuredContent !== undefined) {
      text = JSON.stringify(result.structuredContent);
    }
    if (result.isError) {
      throw new Error(text || `MCP tool ${this.definition.name} failed`);
    }
    return text;
  }

  private static charlieToolName(prefix: string, nativeName: string): string {
    const sanitized = `${prefix}${nativeName}`
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 64);
    if (!sanitized) {
      throw new Error(`MCP tool name is empty after sanitizing: ${nativeName}`);
    }
    return sanitized;
  }

  private static normalizeJsonSchema(schema: unknown): unknown {
    if (schema === undefined || schema === null) {
      return { type: "object", properties: {} };
    }
    if (
      typeof schema === "object" &&
      !Array.isArray(schema) &&
      (schema as { type?: unknown }).type === "object" &&
      !("properties" in schema)
    ) {
      return { ...schema, properties: {} };
    }
    return schema;
  }
}
