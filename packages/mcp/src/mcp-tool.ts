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
    this.name = `${namePrefix}${definition.name}`;
    this.description = definition.description ?? "";
    this.jsonSchema = definition.inputSchema ?? {
      type: "object",
      properties: {},
    };
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
      },
    );
    const text = flattenMcpContent(result.content);
    if (result.isError) {
      throw new Error(text || `MCP tool ${this.definition.name} failed`);
    }
    return text;
  }
}
