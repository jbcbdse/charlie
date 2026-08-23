import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  Server,
  type CallToolResult,
  type ListToolsResult,
  type McpRequestContext,
  type McpServerFactory,
  type Tool,
} from "@modelcontextprotocol/server";
import {
  EventName,
  EventSubscriber,
  eventProducer as defaultEventProducer,
  type ChatAgentContext,
  type EventProducer,
  type EventTypeMap,
  type ITool,
} from "@jbcbdse/charlie-core";

interface ToolsCallExtra {
  mcpReq: {
    notify: (notification: {
      method: "notifications/progress";
      params: {
        progressToken: string | number;
        progress: number;
        message?: string;
      };
    }) => Promise<void>;
  };
}

export interface CharlieMcpServerOptions {
  /** The Charlie tools to expose. */
  tools: ITool[];
  /** Name reported to MCP clients during initialization. */
  name: string;
  /** Version reported to MCP clients during initialization. */
  version: string;
  /** Optional instructions describing how to use the server and its tools. */
  instructions?: string;
  /**
   * Default `ChatAgentContext.meta` for every tools/call. Merge order is
   * constructor `meta`, then the client's per-call `_meta`, then host
   * `runWithMeta` / `CharlieMcpHttpHandler.handle` `meta` (host wins).
   * Use constructor `meta` for process-wide values (stdio); put the
   * authorized user on the HTTP handler per request, not here.
   */
  meta?: ChatAgentContext["meta"];
  /**
   * EventProducer tool handlers' `context.eventProducer.emit(...)` calls
   * (e.g. `ToolProgress`, `Log`) go through. Defaults to core's shared
   * singleton, same as `AiChatAgent`. `ToolStart`/`ToolEnd` are a
   * chat-loop/`ToolExecutor` concept and are never emitted here.
   */
  eventProducer?: EventProducer;
}

/**
 * Wraps Charlie `ITool[]` as an MCP server: `tools/list` reports each tool's
 * name/description/jsonSchema, `tools/call` runs `tool.handle` and
 * translates the result into an MCP `CallToolResult`.
 *
 * Uses the low-level `Server` (not the high-level `McpServer`) on purpose:
 * `ITool.jsonSchema` is already JSON Schema, and not every `ITool` has a Zod
 * schema (`McpTool` does not). `McpServer.registerTool` wants a Standard
 * Schema / Zod input schema. Working against JSON Schema at the protocol
 * boundary is the `ITool` contract.
 *
 * `build()` returns a fresh `Server` on every call — required by
 * `serveStdio`/`createMcpHandler`, which each pin one instance per
 * connection/request. Use `toFactory()` to hand this server to either of
 * them (see `CharlieMcpStdioServer` / `CharlieMcpHttpHandler`).
 */
export class CharlieMcpServer {
  private static readonly metaStore = new AsyncLocalStorage<
    ChatAgentContext["meta"]
  >();

  private readonly toolsByName: Map<string, ITool>;
  private readonly eventProducer: EventProducer;

  constructor(private readonly options: CharlieMcpServerOptions) {
    this.toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));
    this.eventProducer = options.eventProducer ?? defaultEventProducer;
  }

  /**
   * Runs `fn` with per-request `meta` that tools see on `context.meta`.
   * `CharlieMcpHttpHandler.handle`/`fetch` call this; hosts that use
   * `toFactory()` directly can too.
   */
  public runWithMeta<T>(meta: ChatAgentContext["meta"], fn: () => T): T {
    return CharlieMcpServer.metaStore.run(meta, fn);
  }

  public build(): Server {
    return this.createServer();
  }

  /** Adapts `build()` to the `McpServerFactory` shape the SDK's transports expect. */
  public toFactory(): McpServerFactory {
    return (ctx) => this.createServer(ctx);
  }

  private createServer(ctx?: McpRequestContext): Server {
    const server = new Server(
      { name: this.options.name, version: this.options.version },
      { capabilities: { tools: {} }, instructions: this.options.instructions },
    );

    server.setRequestHandler(
      "tools/list",
      (): ListToolsResult => ({
        tools: this.options.tools.map((tool) => this.toMcpTool(tool)),
      }),
    );

    server.setRequestHandler(
      "tools/call",
      (request, extra): Promise<CallToolResult> =>
        this.callTool(
          request.params,
          extra,
          ctx,
          request.params._meta ?? extra.mcpReq._meta,
        ),
    );

    return server;
  }

  private resolveMeta(
    ctx?: McpRequestContext,
    requestMeta?: ChatAgentContext["meta"],
  ): ChatAgentContext["meta"] {
    return {
      ...this.options.meta,
      ...requestMeta,
      ...ctx?.authInfo?.extra,
      ...CharlieMcpServer.metaStore.getStore(),
    };
  }

  private async callTool(
    params: {
      name: string;
      arguments?: Record<string, unknown>;
    },
    extra: ToolsCallExtra,
    ctx?: McpRequestContext,
    requestMeta?: ChatAgentContext["meta"],
  ): Promise<CallToolResult> {
    const tool = this.toolsByName.get(params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${params.name}`);
    }
    const progressToken = this.progressTokenOf(requestMeta);
    const context = this.buildToolCallContext(
      tool.name,
      this.resolveMeta(ctx, this.withoutProgressToken(requestMeta)),
    );
    const stopForwarding =
      progressToken === undefined
        ? undefined
        : this.forwardToolProgress(context, extra, progressToken);
    try {
      const text = await tool.handle(params.arguments ?? {}, context);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    } finally {
      await stopForwarding?.();
    }
  }

  private progressTokenOf(
    requestMeta?: ChatAgentContext["meta"],
  ): string | number | undefined {
    const token = requestMeta?.progressToken;
    return typeof token === "string" || typeof token === "number"
      ? token
      : undefined;
  }

  private withoutProgressToken(
    requestMeta?: ChatAgentContext["meta"],
  ): ChatAgentContext["meta"] | undefined {
    if (!requestMeta || !("progressToken" in requestMeta)) {
      return requestMeta;
    }
    const rest = { ...requestMeta };
    delete rest.progressToken;
    return rest;
  }

  /**
   * Forwards this call's ToolProgress events as MCP notifications/progress
   * while the client supplied a progressToken (SDK clients do this when they
   * pass onprogress). Returns a stop function that unsubscribes and waits
   * for in-flight notifies so they land before the tools/call result.
   */
  private forwardToolProgress(
    context: ChatAgentContext,
    extra: ToolsCallExtra,
    progressToken: string | number,
  ): () => Promise<void> {
    const subscriber = new EventSubscriber(this.eventProducer);
    const pending: Promise<void>[] = [];
    let progress = 0;
    const onProgress = (
      event: EventTypeMap[typeof EventName.ToolProgress],
    ): void => {
      if (event.context.runId !== context.runId) {
        return;
      }
      progress += 1;
      pending.push(
        extra.mcpReq
          .notify({
            method: "notifications/progress",
            params: {
              progressToken,
              progress,
              message: event.message,
            },
          })
          .catch(() => undefined),
      );
    };
    subscriber.on(EventName.ToolProgress, onProgress);
    return async () => {
      subscriber.off(EventName.ToolProgress, onProgress);
      await Promise.all(pending);
    };
  }

  /**
   * A ChatAgentContext for one MCP tools/call. There is no chat loop or LLM
   * turn behind an MCP call, so history is empty and each call gets its own
   * runId. `ToolStart`/`ToolEnd` are emitted by Charlie's `ToolExecutor`
   * around a chat-loop tool call, which this bypasses — they do not fire
   * here. A tool handler that emits `ToolProgress`/`Log` itself via
   * `context.eventProducer` is still observable by whatever subscribed to
   * this server's `eventProducer` (see the constructor option). If the
   * client sent a `progressToken`, `ToolProgress` is also forwarded as MCP
   * `notifications/progress` on this same `tools/call`.
   */
  private buildToolCallContext(
    toolName: string,
    meta: ChatAgentContext["meta"],
  ): ChatAgentContext {
    return {
      runId: randomUUID(),
      modelId: "mcp-server",
      messages: [],
      tools: this.options.tools,
      meta,
      eventProducer: this.eventProducer,
      toolName,
    };
  }

  private toMcpTool(tool: ITool): Tool {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.jsonSchema,
    };
  }
}
