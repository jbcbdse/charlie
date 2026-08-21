import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

jest.setTimeout(20000);

describe("serveCharlieMcpStdio", () => {
  it("serves Charlie tools to a real MCP client over a stdio subprocess", async () => {
    const packageRoot = path.resolve(__dirname, "..");
    const entry = path.resolve(__dirname, "./test-fixtures/stdio-entry.ts");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["-r", "ts-node/register/transpile-only", entry],
      cwd: packageRoot,
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test-client", version: "0.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["echo", "fail"]),
      );
      const result = await client.callTool({
        name: "echo",
        arguments: { message: "over stdio" },
      });
      expect(result.content).toEqual([
        { type: "text", text: "echo: over stdio" },
      ]);
    } finally {
      await client.close();
    }
  });
});
