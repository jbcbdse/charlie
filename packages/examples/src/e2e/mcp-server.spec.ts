import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { startServer, stopServer } from "./helpers/server";
import { BASE_URL } from "./helpers/config";

jest.setTimeout(60_000);

beforeAll(async () => {
  await startServer();
});

afterAll(() => {
  stopServer();
});

describe("Charlie tools as an MCP server, mounted in the real Express app", () => {
  it("lists and calls Charlie tools over HTTP via a real MCP client", async () => {
    const client = new Client({
      name: "examples-e2e-client",
      version: "0.0.0",
    });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`)),
      );
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["CalculatorTool", "CurrentTimeTool"]),
      );
      const result = await client.callTool({
        name: "CalculatorTool",
        arguments: { expr: "2 + 2" },
      });
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([{ type: "text", text: "2 + 2 = 4" }]);
    } finally {
      await client.close();
    }
  });
});
