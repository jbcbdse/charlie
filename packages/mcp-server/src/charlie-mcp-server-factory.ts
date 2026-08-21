import {
  Server,
  type CallToolResult,
  type Implementation,
  type ListToolsResult,
  type McpServerFactory,
  type Tool,
} from "@modelcontextprotocol/server";
import {
  eventProducer as defaultEventProducer,
  type EventProducer,
  type ITool,
} from "@jbcbdse/charlie-core";
import { buildToolCallContext } from "./tool-context";

export interface CreateCharlieMcpServerFactoryOptions {
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
 * Wraps Charlie `ITool[]` as an MCP server factory: `tools/list` reports each
 * tool's name/description/jsonSchema, `tools/call` runs `tool.handle` and
 * translates the result into an MCP `CallToolResult`.
 *
 * Uses the low-level `Server` (not the high-level `McpServer`) on purpose:
 * `ITool.jsonSchema` is already JSON Schema (from `zod-to-json-schema`), and
 * `McpServer.registerTool` wants a Zod schema — Charlie's core uses Zod v3
 * while `@modelcontextprotocol/server` ships Zod v4. Working directly against
 * JSON Schema at the protocol boundary avoids that version mismatch entirely.
 *
 * Returns an `McpServerFactory`, the shape both `serveStdio` and
 * `createMcpHandler` (from `@modelcontextprotocol/server`) accept — build it
 * once and hand it to either transport.
 */
export function createCharlieMcpServerFactory(
  tools: ITool[],
  serverInfo: Implementation,
  options: CreateCharlieMcpServerFactoryOptions = {},
): McpServerFactory {
  return () => buildServer(tools, serverInfo, options);
}

function buildServer(
  tools: ITool[],
  serverInfo: Implementation,
  options: CreateCharlieMcpServerFactoryOptions,
): Server {
  const server = new Server(serverInfo, {
    capabilities: { tools: {} },
    instructions: options.instructions,
  });
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const producer = options.eventProducer ?? defaultEventProducer;

  server.setRequestHandler(
    "tools/list",
    (): ListToolsResult => ({ tools: tools.map(toMcpTool) }),
  );

  server.setRequestHandler(
    "tools/call",
    async (request): Promise<CallToolResult> => {
      const tool = toolsByName.get(request.params.name);
      if (!tool) {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }
      const context = buildToolCallContext(tools, tool.name, producer);
      try {
        const text = await tool.handle(request.params.arguments ?? {}, context);
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
    },
  );

  return server;
}

function toMcpTool(tool: ITool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.jsonSchema,
  };
}
