import type { ITool } from "@jbcbdse/charlie-core";
import { McpSessions, parseMcpConfigFile } from "@jbcbdse/charlie-mcp";

export async function loadOptionalMcp(): Promise<{
  tools: ITool[];
  close: () => Promise<void>;
}> {
  const configPath = process.env.MCP_CONFIG;
  if (!configPath) {
    return { tools: [], close: async () => undefined };
  }
  const mcp = await McpSessions.connect(parseMcpConfigFile(configPath));
  return {
    tools: mcp.tools(),
    close: () => mcp.close(),
  };
}
