import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpHttpHandler } from "@modelcontextprotocol/server";

/**
 * Bridges a Web-standard `McpHttpHandler` onto Node's classic `(req, res)`
 * handler shape, so it can be mounted directly as a route:
 *
 * ```ts
 * app.all("/mcp", toNodeHttpHandler(handler));
 * ```
 *
 * This works verbatim in Express and in a NestJS controller on the (default)
 * Express platform, since both hand route handlers the underlying Node
 * `IncomingMessage`/`ServerResponse`. A Fastify-platform Nest app needs
 * Fastify's own request/response bridge instead.
 *
 * If Express (or similar) body-parsing middleware already ran and left
 * `req.body` populated, it is forwarded as `parsedBody` — the request stream
 * has already been consumed by that middleware, so it cannot be re-read here.
 */
export function toNodeHttpHandler(
  handler: McpHttpHandler,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const parsedBody = (req as IncomingMessage & { body?: unknown }).body;
    // If body-parsing middleware already ran, req's stream is already
    // consumed — build a bodyless Request and forward parsedBody instead of
    // re-reading (and thereby throwing on) the now-disturbed stream.
    const request = toWebRequest(req, parsedBody !== undefined);
    const response = await handler.fetch(
      request,
      parsedBody === undefined ? undefined : { parsedBody },
    );
    await writeWebResponse(response, res);
  };
}

function toWebRequest(
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

async function writeWebResponse(
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
