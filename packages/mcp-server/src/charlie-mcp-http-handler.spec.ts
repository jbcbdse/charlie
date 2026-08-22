import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { CharlieMcpHttpHandler } from "./charlie-mcp-http-handler";
import { EchoTool, FailingTool } from "./test-fixtures/echo-tool";

/**
 * Mimics Express' `express.json()`: drains req's stream and sets `req.body`
 * before handing off to the route handler, same as a real body-parsing
 * middleware would. Regression coverage for a bug where re-reading the
 * already-consumed stream as the Web Request body threw.
 */
function withParsedJsonBody(
  next: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
) {
  return async (
    req: IncomingMessage & { body?: unknown },
    res: ServerResponse,
  ): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    req.body = raw.length > 0 ? JSON.parse(raw) : undefined;
    await next(req, res);
  };
}

describe("CharlieMcpHttpHandler", () => {
  let server: http.Server;
  let baseUrl: URL;

  beforeAll(async () => {
    const mcpHandler = new CharlieMcpHttpHandler({
      tools: [new EchoTool(), new FailingTool()],
      name: "charlie-mcp-server-http-test",
      version: "0.0.0",
    });
    server = http.createServer((req, res) => mcpHandler.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("serves Charlie tools over a real HTTP connection", async () => {
    const client = new Client({ name: "http-test-client", version: "0.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(baseUrl));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["echo", "fail"]),
      );
      const result = await client.callTool({
        name: "echo",
        arguments: { message: "over http" },
      });
      expect(result.content).toEqual([
        { type: "text", text: "echo: over http" },
      ]);
    } finally {
      await client.close();
    }
  });

  it("reports tool errors as isError results over HTTP", async () => {
    const client = new Client({ name: "http-test-client-2", version: "0.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(baseUrl));
      const result = await client.callTool({ name: "fail", arguments: {} });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe("CharlieMcpHttpHandler behind body-parsing middleware", () => {
  let server: http.Server;
  let baseUrl: URL;

  beforeAll(async () => {
    const mcpHandler = new CharlieMcpHttpHandler({
      tools: [new EchoTool()],
      name: "charlie-mcp-server-http-prebody-test",
      version: "0.0.0",
    });
    server = http.createServer(
      withParsedJsonBody((req, res) => mcpHandler.handle(req, res)),
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("still works when req's stream was already consumed and req.body populated", async () => {
    const client = new Client({
      name: "prebody-test-client",
      version: "0.0.0",
    });
    try {
      await client.connect(new StreamableHTTPClientTransport(baseUrl));
      const result = await client.callTool({
        name: "echo",
        arguments: { message: "behind middleware" },
      });
      expect(result.content).toEqual([
        { type: "text", text: "echo: behind middleware" },
      ]);
    } finally {
      await client.close();
    }
  });
});
