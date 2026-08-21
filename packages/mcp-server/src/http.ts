import {
  createMcpHandler,
  type CreateMcpHandlerOptions,
  type Implementation,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import type { ITool } from "@jbcbdse/charlie-core";
import {
  createCharlieMcpServerFactory,
  type CreateCharlieMcpServerFactoryOptions,
} from "./charlie-mcp-server-factory";

export type CreateCharlieMcpHttpHandlerOptions =
  CreateCharlieMcpServerFactoryOptions & CreateMcpHandlerOptions;

/**
 * Builds a Web-standard MCP HTTP handler (`fetch(request) => Promise<Response>`)
 * for Charlie tools. Framework-agnostic by construction — mount it directly
 * behind any Web-standard runtime, or bridge it into a Node framework with
 * `toNodeHttpHandler` (see ./node-http-adapter).
 */
export function createCharlieMcpHttpHandler(
  tools: ITool[],
  serverInfo: Implementation,
  options: CreateCharlieMcpHttpHandlerOptions = {},
): McpHttpHandler {
  const factory = createCharlieMcpServerFactory(tools, serverInfo, options);
  return createMcpHandler(factory, options);
}
