# Charlie — Agent Guide

This guide covers how the repo is structured, what makes it unusual, and how to work across its modules effectively.

## What this is

Charlie is a TypeScript monorepo that provides a thin, stateless layer for calling chat LLMs through a unified interface. The core abstraction is `ChatExecutor` (one per provider) composed into `AiChatAgent` (provider-agnostic). The caller owns message history; the agent owns one round-trip.

## Package map

```
packages/
  core/            — interfaces, AiChatAgent, BaseTool, event system   (@jbcbdse/charlie-core)
  bedrock/         — BedrockChatExecutor, Bedrock embedding generators  (@jbcbdse/charlie-bedrock)
  bedrock-mantle/  — BedrockMantleExecutor (OpenAI-compatible Mantle)   (@jbcbdse/charlie-bedrock-mantle)
  openai/          — OpenAiChatExecutor, GrokExecutor, OAI embeddings  (@jbcbdse/charlie-openai)
  ollama/          — OllamaExecutor (OpenAI-compatible Ollama)          (@jbcbdse/charlie-ollama)
  google/          — GeminiExecutor                                     (@jbcbdse/charlie-google)
  datadog/         — LlmSpansApi (subscribes to events, sends spans)   (@jbcbdse/charlie-datadog)
  examples/        — REPL, HTTP server, e2e tests (not published)
```

Dependency graph: everything depends on `core`. `datadog` depends only on `core`. `examples` depends on all packages. Build order matters: build `core` before anything else.

## Key concepts

**`ChatExecutor`** is the extension point. To add a new provider, implement this interface:
- `modelProvider: string` — used by observability (e.g. `"openai"`, `"aws-bedrock"`)
- `modelId: string` — the model being called
- `execute(input): Promise<ChatAgentGetResponseOutput>` — make the API call, return `responseMessages` and `usage`

Executors must emit two events (see below): `ChatExecutorStart` before the call and `ChatExecutorEnd` after, including `startTime`, `usage`, `responseMessages`, and `modelProvider`.

**`AiChatAgent`** is stateless. It receives `messages` (the full history), calls the executor, runs tool calls in a loop until there are no more, then returns. The caller is responsible for appending returned messages to its own history before the next turn.

**Tools** extend `BaseTool` with a Zod schema and an async `handler`. Setting `returnDirect = true` on a tool causes the agent to stop the loop and return the tool result directly without re-entering the LLM — useful for side-effect tools like account deletion.

**Events** use a singleton `eventProducer` (from `core`). Executors call `this.eventProducer.emit(EventName.X, ...)`. Consumers subscribe via `events.on(EventName.X, handler)` or the typed `EventSubscriber` class. The `datadog` package is implemented entirely as an event subscriber — it never touches the executor.

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
npx jest --config tsconfig.test.json
```

The e2e suite starts the HTTP server as a subprocess, runs tests against it, then tears it down. It uses an LLM judge (calling Claude via Bedrock) to evaluate open-ended responses. See `packages/examples/AGENTS.md` for the agent/model lineup.

Copy `.env.example` to `.env` and fill in keys. AWS credentials must have Bedrock model access in `us-east-1`. `GOOGLE_API_KEY` is optional; the `gemini` agent will error if absent. The `ollama` e2e test needs a local Ollama at `localhost:11434` with `qwen3.6:35b-a3b` pulled; it skips if Ollama is unreachable.

## Adding a new executor package

1. Create `packages/<name>/` with `package.json` (`name: @jbcbdse/charlie-<name>`), `tsconfig.json` (composite, references core), and `src/index.ts`.
2. Implement `ChatExecutor`. Emit `ChatExecutorStart` and `ChatExecutorEnd` via the shared `eventProducer` singleton from `core` — copy the pattern from `openai-chat-executor.ts`.
3. Add `@jbcbdse/charlie-<name>` as a dependency in `packages/examples/package.json` and add it to the `references` array in `packages/examples/tsconfig.json`.
4. Wire up an agent in `packages/examples/src/server/index.ts` and `src/repl/index.ts`.

## Bedrock-specific: models without native tool calling

Some Bedrock models don't support the Converse API's tool-calling feature. Set `toolsSupported: false` on `BedrockChatExecutor` and add `InlineToolCallParser` to `preToolCallTransformers`. The parser reads JSON tool calls embedded in the model's plain-text response and converts them into the standard `MessageToolCall` format. The `titan` agent in examples exercises this path.

