import {
  serveStdio,
  type ServeStdioOptions,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import type { Implementation } from "@modelcontextprotocol/server";
import type { ITool } from "@jbcbdse/charlie-core";
import {
  createCharlieMcpServerFactory,
  type CreateCharlieMcpServerFactoryOptions,
} from "./charlie-mcp-server-factory";

export type ServeCharlieMcpStdioOptions = CreateCharlieMcpServerFactoryOptions &
  ServeStdioOptions;

/**
 * Serves Charlie tools over stdio — for process-to-process MCP clients
 * (Claude Desktop, CLI agents) that spawn this as a child process.
 */
export function serveCharlieMcpStdio(
  tools: ITool[],
  serverInfo: Implementation,
  options: ServeCharlieMcpStdioOptions = {},
): StdioServerHandle {
  const factory = createCharlieMcpServerFactory(tools, serverInfo, options);
  return serveStdio(factory, options);
}
