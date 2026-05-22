# Agents

The examples app exposes 10 named agents, each backed by a different model. In the REPL use `use <agent>` to switch; in the HTTP server pass `"agent": "<name>"` in the POST body.

| Agent | Model | Package |
|-------|-------|---------|
| `claude` | `us.anthropic.claude-sonnet-4-6` | `charlie-bedrock` |
| `mistral` | `mistral.mistral-large-3-675b-instruct` | `charlie-bedrock` |
| `commandr` | `us.meta.llama4-scout-17b-instruct-v1:0` | `charlie-bedrock` |
| `llama` | `us.meta.llama3-3-70b-instruct-v1:0` | `charlie-bedrock` |
| `jamba-large` | `ai21.jamba-1-5-large-v1:0` | `charlie-bedrock` |
| `nova` | `us.amazon.nova-2-lite-v1:0` | `charlie-bedrock` |
| `titan` | `us.amazon.nova-micro-v1:0` | `charlie-bedrock` |
| `gpt4o` | `o4-mini` | `charlie-openai` |
| `grok` | `grok-4.3` | `charlie-openai` (GrokExecutor) |
| `gemini` | `gemini-2.5-flash` | `charlie-google` |

## charlie-bedrock

All seven Bedrock agents use `BedrockChatExecutor`, which calls the AWS Bedrock Converse API. This covers a range of providers (Anthropic, Mistral, Meta, AI21, Amazon) under a single interface.

The `titan` agent sets `toolsSupported: false`, which disables native tool calling. Instead it uses `InlineToolCallParser` — a text-based fallback that parses tool call JSON from the model's plain-text response. This exercises the fallback path for models that predate structured tool support.

## charlie-openai

`gpt4o` uses `OpenAiChatExecutor` directly against the OpenAI API with an o-series reasoning model. `grok` uses `GrokExecutor`, which extends `OpenAiChatExecutor` with a different `baseURL` (`api.x.ai/v1`) — so it exercises the same package and wire protocol against xAI's OpenAI-compatible API.

## charlie-google

`gemini` uses `GeminiExecutor`, which calls the Google Generative AI API. Google uses a distinct `content`/`part` message schema, so this package handles its own message conversion layer.
