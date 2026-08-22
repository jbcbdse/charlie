import {
  serveStdio,
  type ServeStdioOptions,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import {
  CharlieMcpServer,
  type CharlieMcpServerOptions,
} from "./charlie-mcp-server";

export type CharlieMcpStdioServerOptions = CharlieMcpServerOptions &
  ServeStdioOptions;

/**
 * Serves Charlie tools over stdio — for process-to-process MCP clients
 * (Claude Desktop, CLI agents) that spawn this as a child process.
 *
 * ```ts
 * new CharlieMcpStdioServer({ tools, name: "my-charlie-tools", version: "1.0.0" }).serve();
 * ```
 */
export class CharlieMcpStdioServer {
  private readonly mcpServer: CharlieMcpServer;

  constructor(private readonly options: CharlieMcpStdioServerOptions) {
    this.mcpServer = new CharlieMcpServer(options);
  }

  public serve(): StdioServerHandle {
    return serveStdio(this.mcpServer.toFactory(), this.options);
  }
}
