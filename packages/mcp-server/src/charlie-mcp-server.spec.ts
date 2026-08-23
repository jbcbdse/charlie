import {
  InMemoryTransport,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { CharlieMcpServer } from "./charlie-mcp-server";
import {
  EchoTool,
  FailingTool,
  ProgressTool,
  WhoAmITool,
} from "./test-fixtures/echo-tool";

async function connectWith(mcpServer: CharlieMcpServer): Promise<Client> {
  const server = mcpServer.toFactory()({} as McpRequestContext);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    Promise.resolve(server).then((s) => s.connect(serverTransport)),
    client.connect(clientTransport),
  ]);
  return client;
}

async function connectClient(): Promise<Client> {
  return connectWith(
    new CharlieMcpServer({
      tools: [new EchoTool(), new FailingTool()],
      name: "charlie-mcp-server-test",
      version: "0.0.0",
    }),
  );
}

describe("CharlieMcpServer", () => {
  it("lists tools with name, description, and jsonSchema-derived inputSchema", async () => {
    const client = await connectClient();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["echo", "fail"]),
      );
      const echo = tools.find((tool) => tool.name === "echo");
      expect(echo?.description).toBe("Echoes the given message back.");
      expect(echo?.inputSchema.type).toBe("object");
      expect(echo?.inputSchema.properties).toHaveProperty("message");
    } finally {
      await client.close();
    }
  });

  it("calls a tool and returns its result as text content", async () => {
    const client = await connectClient();
    try {
      const result = await client.callTool({
        name: "echo",
        arguments: { message: "hi" },
      });
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([{ type: "text", text: "echo: hi" }]);
    } finally {
      await client.close();
    }
  });

  it("reports a thrown tool error as an isError result", async () => {
    const client = await connectClient();
    try {
      const result = await client.callTool({ name: "fail", arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("always fails"),
      });
    } finally {
      await client.close();
    }
  });

  it("reports invalid arguments as an isError result via the tool's own zod validation", async () => {
    const client = await connectClient();
    try {
      const result = await client.callTool({ name: "echo", arguments: {} });
      expect(result.isError).toBe(true);
      const [content] = result.content;
      expect(content).toMatchObject({ type: "text" });
      expect((content as { text: string }).text).toMatch(/Invalid parameters/);
    } finally {
      await client.close();
    }
  });

  it("rejects tools/call for an unknown tool name", async () => {
    const client = await connectClient();
    try {
      await expect(
        client.callTool({ name: "does-not-exist", arguments: {} }),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  });

  it("rejects duplicate tool names at construction", () => {
    expect(
      () =>
        new CharlieMcpServer({
          tools: [new EchoTool(), new EchoTool()],
          name: "charlie-mcp-server-test",
          version: "0.0.0",
        }),
    ).toThrow(/Duplicate tool name: echo/);
  });

  it("puts constructor meta on ChatAgentContext.meta", async () => {
    const mcpServer = new CharlieMcpServer({
      tools: [new WhoAmITool()],
      name: "charlie-mcp-server-test",
      version: "0.0.0",
      meta: { tenant: "acme" },
    });
    const client = await connectWith(mcpServer);
    try {
      const result = await client.callTool({ name: "whoami", arguments: {} });
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify({ tenant: "acme" }) },
      ]);
    } finally {
      await client.close();
    }
  });

  it("merges runWithMeta over constructor meta for a tools/call", async () => {
    const mcpServer = new CharlieMcpServer({
      tools: [new WhoAmITool()],
      name: "charlie-mcp-server-test",
      version: "0.0.0",
      meta: { tenant: "acme" },
    });
    const client = await connectWith(mcpServer);
    try {
      const result = await mcpServer.runWithMeta({ user: { id: "ada" } }, () =>
        client.callTool({ name: "whoami", arguments: {} }),
      );
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify({ tenant: "acme", user: { id: "ada" } }),
        },
      ]);
    } finally {
      await client.close();
    }
  });

  it("forwards tools/call _meta onto ChatAgentContext.meta; host meta wins clashes", async () => {
    const mcpServer = new CharlieMcpServer({
      tools: [new WhoAmITool()],
      name: "charlie-mcp-server-test",
      version: "0.0.0",
      meta: { tenant: "acme" },
    });
    const client = await connectWith(mcpServer);
    try {
      const result = await mcpServer.runWithMeta({ user: { id: "ada" } }, () =>
        client.callTool({
          name: "whoami",
          arguments: {},
          _meta: { traceId: "t1", user: { id: "mallory" } },
        }),
      );
      expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
        tenant: "acme",
        traceId: "t1",
        user: { id: "ada" },
      });
    } finally {
      await client.close();
    }
  });

  it("does not let tools/call _meta overwrite constructor meta", async () => {
    const mcpServer = new CharlieMcpServer({
      tools: [new WhoAmITool()],
      name: "charlie-mcp-server-test",
      version: "0.0.0",
      meta: { tenant: "acme" },
    });
    const client = await connectWith(mcpServer);
    try {
      const result = await client.callTool({
        name: "whoami",
        arguments: {},
        _meta: { tenant: "mallory", traceId: "t1" },
      });
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify({ tenant: "acme", traceId: "t1" }),
        },
      ]);
    } finally {
      await client.close();
    }
  });

  it("keeps runWithMeta on one server from leaking into another", async () => {
    const serverA = new CharlieMcpServer({
      tools: [new WhoAmITool()],
      name: "charlie-mcp-server-a",
      version: "0.0.0",
      meta: { server: "a" },
    });
    const serverB = new CharlieMcpServer({
      tools: [new WhoAmITool()],
      name: "charlie-mcp-server-b",
      version: "0.0.0",
      meta: { server: "b" },
    });
    const clientB = await connectWith(serverB);
    try {
      const result = await serverA.runWithMeta({ user: { id: "from-a" } }, () =>
        clientB.callTool({ name: "whoami", arguments: {} }),
      );
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify({ server: "b" }) },
      ]);
    } finally {
      await clientB.close();
    }
  });

  it("forwards ToolProgress as notifications/progress when the client asks for progress", async () => {
    const mcpServer = new CharlieMcpServer({
      tools: [new ProgressTool()],
      name: "charlie-mcp-server-test",
      version: "0.0.0",
    });
    const client = await connectWith(mcpServer);
    try {
      const updates: { progress: number; message?: string }[] = [];
      const result = await client.callTool(
        {
          name: "progress",
          arguments: { messages: ["scanning", "found"] },
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
      expect(updates).toEqual([
        { progress: 1, message: "scanning" },
        { progress: 2, message: "found" },
      ]);
      expect(result.content).toEqual([{ type: "text", text: "{}" }]);
    } finally {
      await client.close();
    }
  });

  it("still returns a ToolProgress tool result when the client did not ask for progress", async () => {
    const mcpServer = new CharlieMcpServer({
      tools: [new ProgressTool()],
      name: "charlie-mcp-server-test",
      version: "0.0.0",
    });
    const client = await connectWith(mcpServer);
    try {
      const result = await client.callTool({
        name: "progress",
        arguments: { messages: ["scanning"] },
      });
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([{ type: "text", text: "{}" }]);
    } finally {
      await client.close();
    }
  });

  it("does not put the MCP progressToken on ChatAgentContext.meta", async () => {
    const mcpServer = new CharlieMcpServer({
      tools: [new ProgressTool()],
      name: "charlie-mcp-server-test",
      version: "0.0.0",
      meta: { tenant: "acme" },
    });
    const client = await connectWith(mcpServer);
    try {
      const result = await client.callTool(
        { name: "progress", arguments: {} },
        { onprogress: () => undefined },
      );
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify({ tenant: "acme" }) },
      ]);
    } finally {
      await client.close();
    }
  });
});
