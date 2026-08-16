import { readFileSync } from "node:fs";
import type { McpConfigFile, McpServerConfig } from "./types";

export function parseMcpConfigFile(path: string): McpServerConfig[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as McpConfigFile;
  if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
    throw new Error(`MCP config at ${path} is missing mcpServers`);
  }
  return Object.entries(parsed.mcpServers).map(([name, server]) => {
    if (server.url) {
      return {
        name,
        toolNamePrefix: server.toolNamePrefix,
        transport: {
          type: "http" as const,
          url: server.url,
          headers: server.headers,
        },
      };
    }
    if (!server.command) {
      throw new Error(`MCP server "${name}" must have either command or url`);
    }
    return {
      name,
      toolNamePrefix: server.toolNamePrefix,
      transport: {
        type: "stdio" as const,
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd,
      },
    };
  });
}
