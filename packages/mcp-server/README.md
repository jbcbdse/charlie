# @jbcbdse/charlie-mcp-server

Expose Charlie `ITool[]` (the same tools you pass to `getResponse({ tools })`)
as a real MCP server. This is the reverse of `@jbcbdse/charlie-mcp`, which lets
Charlie *call* tools from external MCP servers — this package lets an external
MCP client call *Charlie's* tools.

Three classes, each constructed with an options object (`tools`, `name`,
`version`, plus transport-specific options) — no factory functions to thread
through. Constructing one is enough to hand it to a DI container (Nest
`FactoryProvider`, InversifyJS, etc.) as a plain injectable instance.

## Why the low-level `Server`, not `McpServer`

`ITool.jsonSchema` is already JSON Schema. The SDK's high-level
`McpServer.registerTool()` wants a Standard Schema / Zod input schema, and
not every `ITool` has one (MCP-adapted tools only have JSON Schema).
`CharlieMcpServer` registers `tools/list` / `tools/call` handlers on the
low-level `Server` and hands JSON Schema straight through, since that is
exactly what the MCP wire format wants for `Tool.inputSchema`. `Server` is
marked `@deprecated` in favor of `McpServer` in the SDK, but that note is
about the ergonomics of hand-authoring Zod tools — wrapping an already-
external tool catalog is the "advanced use case" the SDK docs point at
`Server` for.

## Quickstart

```ts
import { CharlieMcpStdioServer } from "@jbcbdse/charlie-mcp-server";
import { CalculatorTool } from "./tools/calculator.tool";

// stdio — for Claude Desktop, CLI agents, or anything that spawns you as a child process
new CharlieMcpStdioServer({
  tools: [new CalculatorTool()],
  name: "my-charlie-tools",
  version: "1.0.0",
}).serve();
```

## HTTP, and mounting in Express or NestJS

`CharlieMcpHttpHandler` wraps a Web-standard handler
(`fetch(request) => Promise<Response>`) — framework-agnostic by construction
— plus a `handle(req, res)` method that bridges Node's classic request/
response shape, so an instance drops straight into an Express route:

```ts
import express from "express";
import { CharlieMcpHttpHandler } from "@jbcbdse/charlie-mcp-server";

const mcpHandler = new CharlieMcpHttpHandler({
  tools,
  name: "my-charlie-tools",
  version: "1.0.0",
});

const app = express();
app.use(express.json());
app.all("/mcp", (req, res) => mcpHandler.handle(req, res));
```

The same instance and method work verbatim in a NestJS controller on the
(default) Express platform, since Nest hands route handlers the underlying
Node `req`/`res` there too. Construct it once, e.g. via a `FactoryProvider`,
and inject it:

```ts
@Injectable()
export class McpController {
  constructor(private readonly mcpHandler: CharlieMcpHttpHandler) {}

  @All("mcp")
  mcp(@Req() req: Request, @Res() res: Response) {
    return this.mcpHandler.handle(req, res, {
      meta: { user: req.user },
    });
  }
}
```

A Fastify-platform Nest app would need Fastify's own request/response bridge
instead — not something this package builds.

If Express (or similar) body-parsing middleware already populated `req.body`,
`handle` forwards it as `parsedBody` automatically, since the request stream
has already been consumed by that middleware and cannot be re-read.

`CharlieMcpHttpHandler` also exposes `fetch(request, options?)` directly, for
Web-standard runtimes that don't need the Node bridge, and `close()` to tear
down the underlying handler.

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
  call — never fire here. If a tool handler emits `ToolProgress`/`Log`
  itself via `context.eventProducer`, that is still observable in-process
  (core's shared `eventProducer` singleton by default, or pass your own).
  `ToolProgress` is also forwarded as MCP `notifications/progress` on that
  same `tools/call` when the client sent a `progressToken` — SDK clients do
  this automatically if they pass `onprogress`. HTTP can upgrade that POST
  to SSE so the notifications arrive before the result. `Log` is not
  forwarded. `subscriptions/listen` is unused.
- `context.meta` is the merge of constructor `meta`, the client's
  per-call `_meta`, then host `meta` from `handle`/`fetch` (or
  `runWithMeta`). Host keys win, so the authorized user must come from
  the HTTP layer — do not trust `_meta` for auth. Initialize `clientInfo`
  is still only the client app's `name`/`version`, not end-user identity.
