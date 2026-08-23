import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatAgentContext } from "@jbcbdse/charlie-core";
import {
  createMcpHandler,
  type CreateMcpHandlerOptions,
  type McpHandlerRequestOptions,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import {
  CharlieMcpServer,
  type CharlieMcpServerOptions,
} from "./charlie-mcp-server";

export type CharlieMcpHttpHandlerOptions = CharlieMcpServerOptions &
  CreateMcpHandlerOptions;

export type CharlieMcpHttpFetchOptions = McpHandlerRequestOptions & {
  /** Merged into `ChatAgentContext.meta` for tools/call on this request. */
  meta?: ChatAgentContext["meta"];
};

export type CharlieMcpHttpHandleOptions = Pick<
  McpHandlerRequestOptions,
  "authInfo"
> & {
  /** Merged into `ChatAgentContext.meta` for tools/call on this request. */
  meta?: ChatAgentContext["meta"];
};

/**
 * A Web-standard MCP HTTP handler (`fetch`) for Charlie tools, plus a
 * `handle` bridge onto Node's classic `(req, res)` shape — so it mounts
 * directly as an Express route, or a NestJS controller on the (default)
 * Express platform, since both hand route handlers the underlying Node
 * `IncomingMessage`/`ServerResponse`:
 *
 * ```ts
 * const mcpHandler = new CharlieMcpHttpHandler({ tools, name: "my-charlie-tools", version: "1.0.0" });
 * app.all("/mcp", (req, res) => mcpHandler.handle(req, res));
 * ```
 *
 * Constructing this once and providing the instance (e.g. via a Nest
 * `FactoryProvider`) is the intended usage — `fetch`/`handle`/`close` are
 * instance methods with no hidden per-call setup. A Fastify-platform Nest
 * app needs Fastify's own request/response bridge instead of `handle`.
 *
 * If Express (or similar) body-parsing middleware already ran and left
 * `req.body` populated, `handle` forwards it as `parsedBody` — the request
 * stream has already been consumed by that middleware, so it cannot be
 * re-read here.
 */
export class CharlieMcpHttpHandler {
  private readonly mcpServer: CharlieMcpServer;
  private readonly handler: McpHttpHandler;

  constructor(options: CharlieMcpHttpHandlerOptions) {
    this.mcpServer = new CharlieMcpServer(options);
    this.handler = createMcpHandler(this.mcpServer.toFactory(), options);
  }

  public fetch(
    request: Request,
    options?: CharlieMcpHttpFetchOptions,
  ): Promise<Response> {
    const { meta, ...rest } = options ?? {};
    const dispatch = () => this.handler.fetch(request, rest);
    return meta === undefined
      ? dispatch()
      : this.mcpServer.runWithMeta(meta, dispatch);
  }

  public async handle(
    req: IncomingMessage,
    res: ServerResponse,
    options?: CharlieMcpHttpHandleOptions,
  ): Promise<void> {
    const parsedBody = (req as IncomingMessage & { body?: unknown }).body;
    // If body-parsing middleware already ran, req's stream is already
    // consumed — build a bodyless Request and forward parsedBody instead of
    // re-reading (and thereby throwing on) the now-disturbed stream.
    const request = this.toWebRequest(req, parsedBody !== undefined);
    const response = await this.fetch(request, {
      ...options,
      ...(parsedBody === undefined ? {} : { parsedBody }),
    });
    await this.writeWebResponse(response, res);
  }

  public close(): Promise<void> {
    return this.handler.close();
  }

  private toWebRequest(
    req: IncomingMessage,
    bodyAlreadyParsed: boolean,
  ): Request {
    const method = (req.method ?? "GET").toUpperCase();
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else {
        headers.set(key, value);
      }
    }
    const host = req.headers.host ?? "localhost";
    const protocol = (req.socket as { encrypted?: boolean }).encrypted
      ? "https"
      : "http";
    const url = new URL(req.url ?? "/", `${protocol}://${host}`);
    const hasBody = method !== "GET" && method !== "HEAD" && !bodyAlreadyParsed;
    return hasBody
      ? new Request(url, { method, headers, body: req, duplex: "half" })
      : new Request(url, { method, headers });
  }

  private async writeWebResponse(
    response: Response,
    res: ServerResponse,
  ): Promise<void> {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    if (!response.body) {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      res.end();
    }
  }
}
