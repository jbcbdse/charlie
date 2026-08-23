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

  it("forwards CountLettersTool ToolProgress as notifications/progress", async () => {
    const client = new Client({
      name: "examples-e2e-progress-client",
      version: "0.0.0",
    });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`)),
      );
      const updates: { progress: number; message?: string }[] = [];
      const result = await client.callTool(
        {
          name: "CountLettersTool",
          arguments: { word: "hello", letter: "l" },
        },
        {
          onprogress: (update) => {
            updates.push({
              progress: update.progress,
              message: update.message,
            });
          },
        },
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([
        {
          type: "text",
          text: 'There are 2 "L"s in "hello".',
        },
      ]);
      expect(updates).toEqual([
        { progress: 1, message: 'Scanning "hello" for "l"' },
        { progress: 2, message: "Found 2 match(es)" },
      ]);
    } finally {
      await client.close();
    }
  });
});
