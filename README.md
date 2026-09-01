# Charlie

Charlie is a thin, stateless TypeScript layer for calling chat LLMs through one interface. You own message history. Charlie owns one round-trip: call the model, run tools in a loop, stream tokens, return the new messages.

The extension point is `ChatExecutor` (one per provider). `AiChatAgent` is provider-agnostic. Swap the executor to swap models without rewriting tools, history, or observability.

A working REPL, HTTP server, and live e2e suite live in the `examples` package.

## Installation

Configure `.npmrc` to install from GitHub Packages:

```
@jbcbdse:registry=https://npm.pkg.github.com
```

```
npm install @jbcbdse/charlie-core
npm install @jbcbdse/charlie-openai          # GPT, OpenAI Responses, Grok
npm install @jbcbdse/charlie-bedrock         # Bedrock Converse
npm install @jbcbdse/charlie-bedrock-mantle  # Mantle Completions, Responses, Messages
npm install @jbcbdse/charlie-google          # Gemini
npm install @jbcbdse/charlie-ollama          # OpenAI-compatible Ollama
npm install @jbcbdse/charlie-mcp             # call MCP servers as ITool[]
npm install @jbcbdse/charlie-mcp-server      # expose ITool[] as an MCP server
npm install @jbcbdse/charlie-datadog         # LLM Observability spans
```

## Quick start

```ts
import { AiChatAgent, EventName } from "@jbcbdse/charlie-core";
import { OpenAiChatExecutor } from "@jbcbdse/charlie-openai";

const agent = new AiChatAgent({
  chatExecutor: new OpenAiChatExecutor({
    modelId: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY!,
  }),
  systemPromptTemplate: "You are a helpful assistant. User: {{user}}",
});

const { responseMessages, usage } = await agent
  .getResponse({
    messages: [{ role: "user", content: "Hello" }],
    tools: [new CountLettersTool()],
    meta: { user: { preferred_name: "Jon" } },
  })
  .on(EventName.ChatStreamChunk, ({ chunk }) => {
    if (chunk.type === "text") process.stdout.write(chunk.text);
  });
// persist [...history, ...responseMessages] yourself for the next turn
```

`getResponse` is not `async`. It returns a **`ChatRun`**: a thenable with `.on` / `.off` and an async iterator. `.on` and `.off` return the same run, so you can chain listeners and `await` in one expression. `await` still waits for the whole turn, including tool loops. Attach listeners synchronously — the loop starts on `queueMicrotask`.

```ts
for await (const { chunk } of run) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
}
```

## Chat

`AiChatAgent` takes the full `messages` array, calls the executor, runs any tool calls, and repeats until the model stops calling tools (or a `returnDirect` tool fires). It does not keep history between turns.

`ChatMessage` is a common shape across providers: `system`, `user`, `assistant`, `tool_call`, `tool`, and `reasoning`. Bedrock Converse only has user/assistant on the wire; OpenAI has more roles. Charlie maps both ways so the same history works with every executor.

System prompts are templates with `{{key}}` placeholders. `meta` passed to `getResponse` is serialized (YAML by default, via `TemplateSerializer`) and substituted in. That is how user context, available agent names, and similar values reach the prompt without hardcoding.

You can stitch agents together: pipe one agent's output into another for summarization or guardrails, or have a tool call a second agent.

## Streaming

Executors always use the provider stream API and map vendor parts into `CharlieStreamPart`: `text`, `thinking`, `tool_call`, `attachment`, `reasoning`, `usage`, `error`. Core emits `chat:stream:chunk` and folds parts into `responseMessages`.

Thinking tokens are stream-only; they are never concatenated into `MessageAssistant.content`. Yield `reasoning` when the provider needs a round-trip (OpenAI Responses encrypted reasoning, Anthropic thinking signatures). Completions-style `reasoning_content` stays `thinking`.

## Tools

Extend `BaseTool` with a Zod schema and a `handler`. The handler may return a string or `{ content, attachments }`. It receives `ChatAgentContext`, including the `meta` you passed to `getResponse`.

```ts
import { z } from "zod";
import { BaseTool } from "@jbcbdse/charlie-core";

export class CountLettersTool extends BaseTool {
  public name = CountLettersTool.name;
  public description =
    "Count the number of times a letter appears in a word or phrase.";
  public schema = z.object({
    word: z.string().describe("The word or phrase whose letters you want to count."),
    letter: z.string().describe("The letter you want to count in the word or phrase."),
  });
  public handler({ word, letter }: z.infer<typeof this.schema>): string {
    const count = word.toLowerCase().split(letter.toLowerCase()).length - 1;
    return `There are ${count} "${letter.toUpperCase()}"s in "${word}".`;
  }
}
```

Set `returnDirect = true` to stop the loop and return the tool result without re-entering the LLM — useful for side effects such as account deletion. Attachments on a `returnDirect` result are copied onto the synthetic assistant message.

**Tool choice.** Pass `mustCallTool` and/or `requiredToolName` on `getResponse` (copied onto mutable `context`). `mustCallTool` forces at least one tool call. `requiredToolName` forces that one named tool and wins over `mustCallTool`. Force applies to the next executor call, then clears, so the loop can answer after tools run. Re-set it from `preRun` / `postToolCall` / a tool handler to force again. Do not put `required` on `ITool`. Bedrock `toolsSupported: false` cannot force a call (the inline prompt path has no API `toolChoice`).

Some Bedrock models have no native Converse tool calling. Set `toolsSupported: false` on `BedrockChatExecutor` and add `InlineToolCallParser` to `preToolCallTransformers`. The parser reads JSON tool calls out of plain text and converts them to `MessageToolCall`.

## Attachments

User, assistant, and tool messages may include `attachments?: Attachment[]`. Each attachment has a `mimeType` and `data` (base64 string or `Uint8Array`; Node `Buffer` is a `Uint8Array`). There is no `url` field.

Executors send native media when the MIME type is supported (OpenAI `image_url` / `input_image`, Bedrock `image`/`document`, Anthropic image source, Gemini `inlineData`). Otherwise they append a text placeholder such as `[attachment image/png]`. Streamed media arrives as `type: "attachment"` chunks and folds onto the assistant message.

OpenAI Chat and Responses only accept media on user turns, so assistant/tool attachments go out as placeholders and tool images are re-sent as a follow-up user message. Anthropic tool results can still carry image/document blocks.

```ts
await agent.getResponse({
  messages: [
    {
      role: "user",
      content: "What is in this image?",
      attachments: [{ mimeType: "image/png", data: pngBytes }],
    },
  ],
});
```

Encoding and placeholders live on an injectable `AttachmentFormatter` (same pattern as `TemplateSerializer`). Pass `attachmentFormatter` on executor/converter options if you want to swap it.

Charlie does not auto-enable provider image-generation tools or response modalities. If a model already returns media in the chat stream, it is stored as attachments.

## Transformers

Pass `ChatMessageTransformer`s on the agent. Each receives messages and `context` and returns messages (sync or async). `context` is shared for the rest of the run.

- **preRunTransformers** — once before the first executor call. Return the messages to send. Replace `context.tools` (a copy of the `getResponse` tools) to filter the list.
- **preToolCallTransformers** — each LLM response, before tools run.
- **postToolCallTransformers** — after tools run, before the next executor call.
- **postRunTransformers** — once after the turn, reshape `responseMessages`.

```ts
import { AiChatAgent, ToolAssistantFilter } from "@jbcbdse/charlie-core";
import { InlineToolCallParser } from "@jbcbdse/charlie-bedrock";

const agent = new AiChatAgent({
  chatExecutor,
  preRunTransformers: [
    {
      transform(messages, context) {
        context.tools = context.tools.filter((t) => t.name !== "DangerousTool");
        return messages.slice(-20);
      },
    },
  ],
  preToolCallTransformers: [
    new InlineToolCallParser(),
    new ToolAssistantFilter(),
  ],
  postToolCallTransformers: [
    {
      transform(messages, context) {
        context.tools = [];
        return messages;
      },
    },
  ],
  postRunTransformers: [
    {
      transform(messages) {
        return messages.filter((m) => m.role !== "reasoning");
      },
    },
  ],
});
```

`ToolAssistantFilter` keeps only tool-call (and reasoning) messages when the model mixed in assistant text. `InlineToolCallParser` turns JSON embedded in plain text into `MessageToolCall` — use it when Bedrock `toolsSupported` is `false`. `postToolCall` can also set `context.requiredToolName` to force a tool on the next loop.

## Run context

Each `getResponse` call builds one `ChatAgentContext` and hands the **same object** to transformers, tools, executors, and events. Mutate it to change later loop iterations. It is discarded when the run ends; the next `getResponse` starts a new context.

`messages` and `tools` are **shallow copies** of the arrays you passed. Replacing `context.tools` does not change the caller's list. `meta` is the **same object** you passed — writes are visible to the caller.

What you typically mutate:

- **tools** — filter or replace the list for later executor calls
- **mustCallTool** / **requiredToolName** — force a tool on the next executor call. The agent applies this once, then clears it. Set it again from a transformer or tool handler if you need another forced call
- **systemPromptTemplate** and **meta** — the agent re-serializes the template from `meta` on every iteration. Write `systemPromptTemplate`, not `systemPrompt`; the agent overwrites `systemPrompt` each loop
- **messages** — `preRun` returns the array the rest of the run will send. After that the agent appends tool-loop messages itself

`runId` and `modelId` are set by the agent. `toolName` / `toolCallId` exist only while a tool `handle()` is running.

```ts
class AdvanceStepTool extends BaseTool {
  public name = "AdvanceStepTool";
  public description = "Move the run into the summarize step.";
  public schema = z.object({});
  public handler(
    _params: z.infer<typeof this.schema>,
    context: ChatAgentContext,
  ): string {
    context.meta.step = "summarize";
    context.systemPromptTemplate = "Summarize for {{user}}.";
    context.requiredToolName = "WriteSummary";
    return "advanced";
  }
}
```

## Events

Executors emit `ChatExecutorStart` and `ChatExecutorEnd` (plus raw request/response, stream chunks, and tool events). You subscribe at three scopes — they are not limited to the global bus.

**This run.** `ChatRun.on` filters by `context.runId` for you. Attach listeners synchronously after `getResponse` returns.

```ts
const result = await agent
  .getResponse({ messages, tools })
  .on(EventName.ChatStreamChunk, ({ chunk }) => {
    if (chunk.type === "text") process.stdout.write(chunk.text);
  })
  .on(EventName.ToolProgress, ({ message, toolName }) => {
    console.log(`[progress] ${toolName}: ${message}`);
  });
```

**This agent / process.** Construct an `EventProducer`, pass it into `AiChatAgent` (and into tools via `context.eventProducer`), and subscribe with `EventSubscriber`. `@jbcbdse/charlie-datadog` listens to whichever subscriber you give it.

```ts
import { AiChatAgent, EventName, EventProducer, EventSubscriber } from "@jbcbdse/charlie-core";
import { LlmSpansApi } from "@jbcbdse/charlie-datadog";

const producer = new EventProducer();
const bus = new EventSubscriber(producer);

const agent = new AiChatAgent({
  chatExecutor,
  eventProducer: producer,
});

bus.on(EventName.ChatExecutorEnd, ({ usage, modelId }) => {
  console.log(modelId, usage);
});

new LlmSpansApi({
  apiKey: process.env.DD_API_KEY!,
  tags: { service: "my-service", env: "dev" },
}).listen(bus);
```

**Process-wide default.** `events` is an `EventSubscriber` on the shared `eventProducer` singleton. Executors and agents use that singleton if you do not inject your own. A global listener must filter by `requestId` / `runId` itself.

```ts
import { events, EventName } from "@jbcbdse/charlie-core";

events.on(EventName.Log, ({ message, level }) => {
  console.log(level, message);
});
```

## Embeddings

`TextEmbeddingGenerator` is a small interface: generate vectors and always return `modelId` with the result. Implementations:

- `OpenAiTextEmbeddingGenerator`
- `TitanTextEmbeddingGenerator` and `CohereTextEmbeddingGenerator` (Bedrock)

Vectors are model-specific. A common interface lets you A/B generators against your own store.

## MCP

**Client** (`@jbcbdse/charlie-mcp`). `McpSessions.connect` talks to stdio or Streamable HTTP servers. MCP tools become `ITool[]` for `getResponse`. Resources (`listResources` / `readResource`) and prompts (`listPrompts` / `getPrompt` → `ChatMessage[]`) are caller APIs — `AiChatAgent` never sees them. MCP image blocks with bytes become Charlie attachments.

```ts
import { McpSessions } from "@jbcbdse/charlie-mcp";

const mcp = await McpSessions.connect([
  {
    name: "everything",
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    },
  },
]);

await agent.getResponse({ messages: history, tools: mcp.tools() });
await mcp.close();
```

**Server** (`@jbcbdse/charlie-mcp-server`). The reverse: expose Charlie `ITool[]` as `tools/list` + `tools/call`. `CharlieMcpStdioServer.serve()` for stdio; `CharlieMcpHttpHandler.handle(req, res)` mounts as an Express (or Nest-on-Express) route. ToolProgress is forwarded as MCP `notifications/progress` when the client sent a `progressToken`.

## Providers

| Package | Executors |
| --- | --- |
| `@jbcbdse/charlie-openai` | `OpenAiChatExecutor`, `OpenAiResponsesExecutor`, `GrokExecutor` |
| `@jbcbdse/charlie-bedrock` | `BedrockChatExecutor` (Converse) |
| `@jbcbdse/charlie-bedrock-mantle` | Completions, Responses (`store: false`), Anthropic Messages |
| `@jbcbdse/charlie-google` | `GeminiExecutor` |
| `@jbcbdse/charlie-ollama` | `OllamaExecutor` |

`ChatExecutor` is three fields: `modelProvider`, `modelId`, and `execute(input)`. Implement that plus `ChatExecutorStart` / `ChatExecutorEnd` to add a provider. Copy the pattern from `openai-chat-executor.ts`.

## Footnotes

Charlie stays small by leaving you in control of everything around the round-trip:

- **Memory.** Pass an array of `ChatMessage` objects. How you store and reload them is yours.
- **Vector search.** Charlie can generate embeddings. Storing them and searching is yours; a search tool is just another `ITool`.
- **Text splitting.** Chunk documents before embedding so vectors stay specific. Charlie will not split Wikipedia for you.
