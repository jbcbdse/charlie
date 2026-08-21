# @jbcbdse/charlie-mcp-server

Expose Charlie `ITool[]` (the same tools you pass to `getResponse({ tools })`)
as a real MCP server. This is the reverse of `@jbcbdse/charlie-mcp`, which lets
Charlie *call* tools from external MCP servers — this package lets an external
MCP client call *Charlie's* tools.

## Why the low-level `Server`, not `McpServer`

`ITool.jsonSchema` is already JSON Schema (built by `zod-to-json-schema` from
the tool's Zod v3 schema). The SDK's high-level `McpServer.registerTool()`
wants a Zod schema, and `@modelcontextprotocol/server` ships Zod v4 internally
— mixing the two would mean converting Charlie's Zod v3 schema through JSON
Schema and back into a different Zod major version. Instead, this package
registers `tools/list` / `tools/call` handlers on the low-level `Server`
directly and hands JSON Schema straight through, since that is exactly what
the MCP wire format wants for `Tool.inputSchema`. `Server` is marked
`@deprecated` in favor of `McpServer` in the SDK, but that note is about the
ergonomics of hand-authoring Zod tools — wrapping an already-external tool
catalog is the "advanced use case" the SDK docs point at `Server` for.

## Quickstart

```ts
import { createCharlieMcpServerFactory, serveCharlieMcpStdio } from "@jbcbdse/charlie-mcp-server";
import { CalculatorTool } from "./tools/calculator.tool";

// stdio — for Claude Desktop, CLI agents, or anything that spawns you as a child process
serveCharlieMcpStdio([new CalculatorTool()], {
  name: "my-charlie-tools",
  version: "1.0.0",
});
```

## HTTP, and mounting in Express or NestJS

`createCharlieMcpHttpHandler` builds a Web-standard handler
(`fetch(request) => Promise<Response>`) — framework-agnostic by construction.
`toNodeHttpHandler` bridges it onto Node's classic `(req, res)` shape, so it
drops straight into an Express route:

```ts
import express from "express";
import { createCharlieMcpHttpHandler, toNodeHttpHandler } from "@jbcbdse/charlie-mcp-server";

const handler = createCharlieMcpHttpHandler(tools, {
  name: "my-charlie-tools",
  version: "1.0.0",
});

const app = express();
app.use(express.json());
app.all("/mcp", toNodeHttpHandler(handler));
```

The same adapter works verbatim in a NestJS controller on the (default)
Express platform, since Nest hands route handlers the underlying Node
`req`/`res` there too:

```ts
@All("mcp")
mcp(@Req() req: Request, @Res() res: Response) {
  return toNodeHttpHandler(handler)(req, res);
}
```

A Fastify-platform Nest app would need Fastify's own request/response bridge
instead — not something this package builds.

If Express (or similar) body-parsing middleware already populated `req.body`,
`toNodeHttpHandler` forwards it as `parsedBody` automatically, since the
request stream has already been consumed by that middleware and cannot be
re-read.

## Tool-call semantics

- A tool's return string becomes `{ content: [{ type: "text", text }] }`.
- A thrown error (including a `BaseTool` Zod validation failure) becomes
  `{ content: [...], isError: true }` — the same tolerant behavior
  `ToolExecutor` uses on the Charlie side, so a bad call doesn't kill the
  session.
- `ITool.returnDirect` is a Charlie chat-loop concept (skip the rest of the
  loop and hand the result straight to the caller) and has no meaning to an
  MCP client — it is ignored here.
- Each `tools/call` gets its own `ChatAgentContext` (fresh `runId`, empty
  `messages`). There is no chat run behind an MCP call, so `ToolStart`/
  `ToolEnd` — emitted by Charlie's `ToolExecutor` around a chat-loop tool
  call — never fire here. If a tool handler emits `ToolProgress`/`Log` itself
  via `context.eventProducer`, that is still observable: by default it goes
  through core's shared `eventProducer` singleton (same as `AiChatAgent`),
  or pass your own via the `eventProducer` option to
  `createCharlieMcpServerFactory`/`serveCharlieMcpStdio`/`createCharlieMcpHttpHandler`.
