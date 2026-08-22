import { randomUUID } from "node:crypto";
import {
  Server,
  type CallToolResult,
  type ListToolsResult,
  type McpServerFactory,
  type Tool,
} from "@modelcontextprotocol/server";
import {
  eventProducer as defaultEventProducer,
  type ChatAgentContext,
  type EventProducer,
  type ITool,
} from "@jbcbdse/charlie-core";

export interface CharlieMcpServerOptions {
  /** The Charlie tools to expose. */
  tools: ITool[];
  /** Name reported to MCP clients during initialization. */
  name: string;
  /** Version reported to MCP clients during initialization. */
  version: string;
  /** Optional instructions describing how to use the server and its tools. */
  instructions?: string;
  /**
   * EventProducer tool handlers' `context.eventProducer.emit(...)` calls
   * (e.g. `ToolProgress`, `Log`) go through. Defaults to core's shared
   * singleton, same as `AiChatAgent`. `ToolStart`/`ToolEnd` are a
   * chat-loop/`ToolExecutor` concept and are never emitted here.
   */
  eventProducer?: EventProducer;
}

/**
 * Wraps Charlie `ITool[]` as an MCP server: `tools/list` reports each tool's
 * name/description/jsonSchema, `tools/call` runs `tool.handle` and
 * translates the result into an MCP `CallToolResult`.
 *
 * Uses the low-level `Server` (not the high-level `McpServer`) on purpose:
 * `ITool.jsonSchema` is already JSON Schema (from `zod-to-json-schema`), and
 * `McpServer.registerTool` wants a Zod schema — Charlie's core uses Zod v3
 * while `@modelcontextprotocol/server` ships Zod v4. Working directly against
 * JSON Schema at the protocol boundary avoids that version mismatch entirely.
 *
 * `build()` returns a fresh `Server` on every call — required by
 * `serveStdio`/`createMcpHandler`, which each pin one instance per
 * connection/request. Use `toFactory()` to hand this server to either of
 * them (see `CharlieMcpStdioServer` / `CharlieMcpHttpHandler`).
 */
export class CharlieMcpServer {
  private readonly toolsByName: Map<string, ITool>;
  private readonly eventProducer: EventProducer;

  constructor(private readonly options: CharlieMcpServerOptions) {
    this.toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));
    this.eventProducer = options.eventProducer ?? defaultEventProducer;
  }

  public build(): Server {
    const server = new Server(
      { name: this.options.name, version: this.options.version },
      { capabilities: { tools: {} }, instructions: this.options.instructions },
    );

    server.setRequestHandler(
      "tools/list",
      (): ListToolsResult => ({ tools: this.options.tools.map(toMcpTool) }),
    );

    server.setRequestHandler(
      "tools/call",
      (request): Promise<CallToolResult> => this.callTool(request.params),
    );

    return server;
  }

  /** Adapts `build()` to the `McpServerFactory` shape the SDK's transports expect. */
  public toFactory(): McpServerFactory {
    return () => this.build();
  }

  private async callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<CallToolResult> {
    const tool = this.toolsByName.get(params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${params.name}`);
    }
    const context = this.buildToolCallContext(tool.name);
    try {
      const text = await tool.handle(params.arguments ?? {}, context);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * A ChatAgentContext for one MCP tools/call. There is no chat loop or LLM
   * turn behind an MCP call, so history is empty and each call gets its own
   * runId. `ToolStart`/`ToolEnd` are emitted by Charlie's `ToolExecutor`
   * around a chat-loop tool call, which this bypasses — they do not fire
   * here. A tool handler that emits `ToolProgress`/`Log` itself via
   * `context.eventProducer` is still observable by whatever subscribed to
   * this server's `eventProducer` (see the constructor option).
   */
  private buildToolCallContext(toolName: string): ChatAgentContext {
    return {
      runId: randomUUID(),
      modelId: "mcp-server",
      messages: [],
      tools: this.options.tools,
      meta: {},
      eventProducer: this.eventProducer,
      toolName,
    };
  }
}

function toMcpTool(tool: ITool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.jsonSchema,
  };
}
