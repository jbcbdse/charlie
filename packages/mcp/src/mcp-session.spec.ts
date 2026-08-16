import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { EventProducer, type ChatAgentContext } from "@jbcbdse/charlie-core";
import { McpSession } from "./mcp-session";
import { McpSessions } from "./mcp-sessions";
import { parseMcpConfigFile } from "./parse-mcp-config";

function mockContext(producer = new EventProducer()): ChatAgentContext {
  return {
    runId: "run",
    modelId: "mock",
    messages: [],
    meta: {},
    eventProducer: producer,
  };
}

async function connectFixture(options?: {
  fail?: boolean;
  name?: string;
  toolNamePrefix?: string;
}): Promise<{ session: McpSession; close: () => Promise<void> }> {
  const mcpServer = new McpServer({ name: "fixture", version: "1.0.0" });
  mcpServer.registerTool("ping", { description: "Ping" }, async () => ({
    content: [{ type: "text" as const, text: "pong" }],
  }));
  mcpServer.registerTool(
    "echo",
    { description: "Echo a message" },
    async () => ({
      content: [{ type: "text" as const, text: "echo" }],
    }),
  );
  if (options?.fail) {
    mcpServer.registerTool(
      "fail",
      { description: "Always fails" },
      async () => ({
        isError: true,
        content: [{ type: "text" as const, text: "nope" }],
      }),
    );
  }
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([
    mcpServer.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const session = await McpSession.fromClient(options?.name ?? "fix", client, {
    toolNamePrefix: options?.toolNamePrefix,
  });
  return {
    session,
    close: async () => {
      await session.close();
      await mcpServer.close();
    },
  };
}

describe("McpSession in-process", () => {
  it("throws when a tool returns isError", async () => {
    const { session, close } = await connectFixture({ fail: true });
    try {
      const tool = session.tools().find((item) => item.name.endsWith("fail"));
      await expect(tool?.handle({}, mockContext())).rejects.toThrow("nope");
    } finally {
      await close();
    }
  });

  it("prefixes Charlie-facing tool names and calls the native name", async () => {
    const { session, close } = await connectFixture({ name: "alpha" });
    try {
      const names = session.tools().map((tool) => tool.name);
      expect(names).toContain("alpha__echo");
      const ping = session.tools().find((tool) => tool.name === "alpha__ping");
      await expect(ping?.handle({}, mockContext())).resolves.toBe("pong");
    } finally {
      await close();
    }
  });

  it("can disable the name prefix", async () => {
    const { session, close } = await connectFixture({
      name: "alpha",
      toolNamePrefix: "",
    });
    try {
      expect(session.tools().map((tool) => tool.name)).toContain("echo");
    } finally {
      await close();
    }
  });
});

describe("parseMcpConfigFile", () => {
  it("maps command entries to stdio and url entries to http", () => {
    const dir = mkdtempSync(join(tmpdir(), "charlie-mcp-"));
    const path = join(dir, "mcp.json");
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          local: { command: "npx", args: ["-y", "foo"] },
          remote: {
            url: "http://localhost:3000/mcp",
            headers: { Authorization: "Bearer x" },
          },
        },
      }),
    );
    expect(parseMcpConfigFile(path)).toEqual([
      {
        name: "local",
        transport: { type: "stdio", command: "npx", args: ["-y", "foo"] },
      },
      {
        name: "remote",
        transport: {
          type: "http",
          url: "http://localhost:3000/mcp",
          headers: { Authorization: "Bearer x" },
        },
      },
    ]);
  });
});

describe("McpSessions", () => {
  it("rejects duplicate server names", async () => {
    await expect(
      McpSessions.connect([
        {
          name: "dup",
          transport: { type: "http", url: "http://127.0.0.1:1/mcp" },
        },
        {
          name: "dup",
          transport: { type: "http", url: "http://127.0.0.1:2/mcp" },
        },
      ]),
    ).rejects.toThrow("Duplicate MCP server name");
  });
});
