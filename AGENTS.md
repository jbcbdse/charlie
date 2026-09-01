# Charlie — Agent Guide

This guide covers how the repo is structured, what makes it unusual, and how to work across its modules effectively.

## What this is

Charlie is a TypeScript monorepo that provides a thin, stateless layer for calling chat LLMs through a unified interface. The core abstraction is `ChatExecutor` (one per provider) composed into `AiChatAgent` (provider-agnostic). The caller owns message history; the agent owns one round-trip.

## Package map

```
packages/
  core/            — interfaces, AiChatAgent, BaseTool, event system   (@jbcbdse/charlie-core)
  bedrock/         — BedrockChatExecutor, Bedrock embedding generators  (@jbcbdse/charlie-bedrock)
  bedrock-mantle/  — Completions, Responses, and Messages executors    (@jbcbdse/charlie-bedrock-mantle)
  openai/          — OpenAiChatExecutor, OpenAiResponsesExecutor, Grok (@jbcbdse/charlie-openai)
  ollama/          — OllamaExecutor, OllamaTextEmbeddingGenerator      (@jbcbdse/charlie-ollama)
  google/          — GeminiExecutor                                     (@jbcbdse/charlie-google)
  datadog/         — LlmSpansApi (subscribes to events, sends spans)   (@jbcbdse/charlie-datadog)
  mcp/             — MCP client: tools as ITool, resource/prompt APIs  (@jbcbdse/charlie-mcp)
  mcp-server/      — MCP server: expose ITool[] as tools/list+call     (@jbcbdse/charlie-mcp-server)
  examples/        — REPL, HTTP server, e2e tests (not published)
```

Dependency graph: everything depends on `core`. `datadog`, `mcp`, and `mcp-server` depend only on `core`. `examples` depends on all packages. Build order matters: build `core` before anything else.

## Key concepts

**`ChatExecutor`** is the extension point. To add a new provider, implement this interface:

- `modelProvider: string` — used by observability (e.g. `"openai"`, `"aws-bedrock"`)
- `modelId: string` — the model being called
- `execute(input): Promise<ChatAgentGetResponseOutput>` — make the API call, return `responseMessages` and `usage`

Executors must emit two events (see below): `ChatExecutorStart` before the call and `ChatExecutorEnd` after, including `startTime`, `usage`, `responseMessages`, and `modelProvider`.

**`AiChatAgent`** is stateless. It receives `messages` (the full history), calls the executor, runs tool calls in a loop until there are no more, then returns. The caller is responsible for appending returned messages to its own history before the next turn.

`getResponse` is not `async`. It returns a thenable **`ChatRun`** (`Promise` plus `.on` / `.off` and an async iterator). `.on` and `.off` return the same run, so listeners can chain into `await`. `await agent.getResponse(...)` still waits for the whole turn, including tool loops. Attach listeners synchronously after `getResponse` returns — the loop starts on `queueMicrotask`. `ChatRun.on` filters by `context.runId`.

```typescript
const { responseMessages } = await agent.getResponse({ messages, tools });
```

```typescript
const { responseMessages } = await agent
  .getResponse({ messages, tools, meta })
  .on(EventName.ChatStreamChunk, ({ chunk }) => {
    if (chunk.type === "text") process.stdout.write(chunk.text);
    if (chunk.type === "thinking") process.stderr.write(chunk.text);
  })
  .on(EventName.ToolProgress, ({ message, toolName }) => {
    console.log(`[progress] ${toolName}: ${message}`);
  });
```

```typescript
const run = agent.getResponse({ messages, tools });
for await (const { chunk } of run) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
}
const result = await run;
```

Executors always use the provider stream API and map vendor parts into a common `CharlieStreamPart` stream (`text`, `thinking`, `tool_call`, `attachment`, `reasoning`, `usage`, `error`). `CharlieStreamConsumer` in core emits `chat:stream:chunk` and folds parts into `responseMessages`. Thinking tokens are never concatenated into `MessageAssistant.content`. Yield `reasoning` when the provider needs a round-trip (OpenAI Responses encrypted reasoning, Anthropic thinking signatures). Completions-style `reasoning_content` stays `thinking` (stream-only). On `tool_call` parts, `id` and `name` are last-wins; `argumentsText` is append-only. Attachment parts (`mimeType` + `data`) fold onto `MessageAssistant.attachments`.

**Tools** extend `BaseTool` with a Zod schema and an async `handler`. The handler may return a string or `{ content, attachments }`. Setting `returnDirect = true` on a tool causes the agent to stop the loop and return the tool result directly without re-entering the LLM — useful for side-effect tools like account deletion. `returnDirect` copies attachments onto the synthetic assistant message.

**ChatMessage attachments**: optional `attachments?: Attachment[]` on user, assistant, and tool messages. `content` stays a string. Executors send native media blocks (OpenAI `image_url` / `input_image`, Bedrock `image`/`document`, Anthropic image source, Gemini `inlineData`) when the MIME type is supported; otherwise they leave a text placeholder. Callers pass bytes or base64; there is no `url` field.

**Tool choice**: pass `mustCallTool` / `requiredToolName` on `getResponse` (copied onto mutable `context`). `mustCallTool` forces at least one tool call (`required` / Anthropic `any` / Gemini `ANY`). `requiredToolName` forces that one named tool and wins over `mustCallTool`. Force applies to the next executor call, then clears, so the loop can answer after tools run — re-set on context from preRun / postToolCall / a tool handler to force again. Do not put `required` on `ITool`. Bedrock `toolsSupported: false` cannot force a call (inline prompt path has no API `toolChoice`).

**preRunTransformers** run once before the first executor call. They return the messages to send and may replace `context.tools` (a mutable copy of the `getResponse` tools). Use this to filter a large tool list or rewrite incoming messages without wrapping every `getResponse` call. `preToolCallTransformers` / `postToolCallTransformers` / `postRunTransformers` still process LLM output around tool execution.

**MCP** (`@jbcbdse/charlie-mcp`) is a client adapter, not an executor. `McpSessions.connect` talks to stdio or Streamable HTTP servers. MCP tools become `ITool[]` for `getResponse`. Resources (`listResources` / `readResource`) and prompts (`listPrompts` / `getPrompt` → `ChatMessage[]`) are caller APIs — `AiChatAgent` never sees them. The REPL/server load servers from `MCP_CONFIG` if set. MCP image blocks with bytes become Charlie attachments instead of placeholders.

**MCP server** (`@jbcbdse/charlie-mcp-server`) is the reverse: it exposes Charlie `ITool[]` as an MCP server, so an external MCP client can call them. Three classes, each constructed with an options object (`tools`, `name`, `version`, plus transport options) so an instance can be handed straight to a DI container. `CharlieMcpServer` wraps the SDK's low-level `Server` (not `McpServer` — Charlie's `ITool.jsonSchema` is already JSON Schema, and not every `ITool` has a Zod schema) and exposes `toFactory()` for the SDK's factory-shaped transports. `CharlieMcpStdioServer.serve()` wraps stdio; `CharlieMcpHttpHandler` wraps a Web-standard `fetch` handler and its `handle(req, res)` method bridges Node's classic request/response shape, which is what makes an instance mountable as an Express route or injectable into a NestJS controller on the Express platform. `examples`' server mounts one at `POST/GET/DELETE /mcp`. A tool that emits `ToolProgress` is forwarded to the MCP client as `notifications/progress` on that same `tools/call` when the client sent a `progressToken` (`onprogress` on the SDK client).

**Events** use a singleton `eventProducer` (from `core`). Executors call `this.eventProducer.emit(EventName.X, ...)`. Consumers subscribe via `events.on(EventName.X, handler)`, the typed `EventSubscriber` class, or `ChatRun.on` (run-scoped). The `datadog` package is implemented entirely as an event subscriber — it never touches the executor. Stream chunks use the same bus; a global subscriber must still filter by `requestId` / `runId`.

**Template system**: the system prompt is a string with `{{key}}` placeholders. At runtime, `meta` passed to `getResponse` is serialized (YAML by default) and substituted in. This is how user context, available agent names, etc. reach the prompt without hardcoding.

## Building

All packages use TypeScript composite projects (`"composite": true` in tsconfig) with project references. You must build in dependency order:

```bash
npm run build --workspaces   # builds all packages in correct order
```

Or build individually, starting from `core`:

```bash
cd packages/core && npm run build
cd packages/bedrock && npm run build   # etc.
```

The `examples` package has two tsconfig files: `tsconfig.json` for the REPL/server and `tsconfig.test.json` for the e2e suite (which has looser settings to accommodate Jest).

## Testing

Unit tests (only `core` has meaningful ones):

```bash
npm run test --workspaces
```

E2e tests (require live API keys in `.env`):

```bash
cd packages/examples
npm run test:e2e
```

The e2e suite starts the HTTP server as a subprocess, runs tests against it, then tears it down. It uses an LLM judge (calling Claude via Bedrock) to evaluate open-ended responses. See `packages/examples/AGENTS.md` for the agent/model lineup.

Copy `.env.example` to `.env` and fill in keys. AWS credentials must have Bedrock model access in `us-east-1`. `GOOGLE_API_KEY` is optional; the `gemini` agent will error if absent. The `ollama` e2e tests need a local Ollama at `localhost:11434` with `qwen3.6:35b-a3b` (chat) and `nomic-embed-text` (embeddings) pulled; they skip if Ollama is unreachable.

## Adding a new executor package

1. Create `packages/<name>/` with `package.json` (`name: @jbcbdse/charlie-<name>`), `tsconfig.json` (composite, references core), and `src/index.ts`.
2. Implement `ChatExecutor`. Emit `ChatExecutorStart` and `ChatExecutorEnd` via the shared `eventProducer` singleton from `core` — copy the pattern from `openai-chat-executor.ts`.
3. Add `@jbcbdse/charlie-<name>` as a dependency in `packages/examples/package.json` and add it to the `references` array in `packages/examples/tsconfig.json`.
4. Wire up an agent in `packages/examples/src/server/index.ts` and `src/repl/index.ts`.

## Bedrock-specific: models without native tool calling

Some Bedrock models don't support the Converse API's tool-calling feature. Set `toolsSupported: false` on `BedrockChatExecutor` and add `InlineToolCallParser` to `preToolCallTransformers`. The parser reads JSON tool calls embedded in the model's plain-text response and converts them into the standard `MessageToolCall` format. The `titan` agent in examples exercises this path.

## Bedrock Mantle APIs

Mantle has three inference APIs; pick the executor that matches the model (see AWS model API compatibility):

- `BedrockMantleExecutor` — Chat Completions (`/v1/chat/completions`). Default `openai.gpt-oss-20b`. Grok uses `bedrockMantleBaseURL("openai/v1")`.
- `BedrockMantleResponsesExecutor` — Responses (`store: false`, encrypted reasoning round-tripped as `role: "reasoning"`). GPT-5.6 models use `/openai/v1`.
- `BedrockMantleMessagesExecutor` — Anthropic Messages (`/anthropic/v1/messages`) via `@anthropic-ai/bedrock-sdk`. Claude thinking blocks are also `role: "reasoning"`.
