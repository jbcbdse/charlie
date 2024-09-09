# Charlie

Charlie is a TypeScript framework for executing different AI models with a unified interface.

Charlie is the handler of many agents.

## Features

### Chat Agent

Charlie provides a `ChatAgent` interface, and implementations for Bedrock Converse and OpenAI. The key implementation is the `AiChatAgent` class.

The **Agent**'s job is to receive a single request, call the appropriate **tools**, and provide a single response. It invokes the AI model through a `ChatExecutor` implementation. The request contains an array of `ChatMessage` objects, a **prompt template**, an array of `BaseTool` objects representing the tools the agent can execute, and a `ChatAgentContext` object that is visible to the Agent, the Executor, all Tools, and can fill in blanks in the System Prompt via the Template.

The Agent is stateless and only persists contextual data for a single interaction. It is up to you to provide **memory** by storing and providing the array of `ChatMessage` objects. While an Agent may seem complex, invoking the agent is a fairly lightweight function call. You can create more complex workflows by stitching agent calls together. You might pipe the output from one Agent to another Agent for post-processing, summarization, or to apply guardrails. You might have a Tool that calls a second Agent to help provide an answer to the first Agent.

The `AiChatAgent` class is likely the only `ChatAgent` class you need, and you can tailor it for various LLMs:

- You must provide `ChatExecutor` to call your preferred model.
- Tume your system prompt template to provide appropriate base instructions for the given model.
- Inject a different `TemplateSerializer` to change our blanks are filled in the system prompt. By default, YAML is used, but other models may work better with different formats for provided context parameters.
- Inject one or more pre- and post-tool-call transformers to tweak the output from the LLM before or after tools are executed.

### Chat Executors

You must provide a `ChatExecutor` to the `AiChatAgent`. Two executors are provided by this package (so far): `BedrockChatExecutor` and `OpenAiChatExecutor`.

Tool calling in Bedrock's Converse API is only supported by certain models, other models are supported through the `BedrockChatExecutor`. It provides a default `toolPromptGenerator` that inserts detailed instructions in the system prompt telling the AI how to call tools. It also provides a default `toolCallParser` to parse out tool calls from "assistant" messages and treat them as if they came natively from the Converse API.

The `ChatExecutor` interface is simple. You can write your own `ChatExecutor` for providers not implemented here and use it with the `AiChatAgent`. This is the major benefit to this library: you can easily swap agents in your application to use different AI models.

### ChatMessage interface

The `ChatMessage` interfaces provide a common data structure meeting the features of _most_ chat APIs. For example, Bedrock Converse only supports "user" and "assistant" messages while OpenAI supports "user", "assistant", "tool", and "tool_call" as different message types. By providing a common interface, your same chat history can be sent to any `ChatExecutor` and work with any supported LLM.

### events

The `events`, `EventName`, and `EventTypeMap` exports allow you to subscribe to events with strong types. Use this to better observe Charlie's behavior.

`ChatExecutor` implementations, including any you provide, should implement a couple key events that provide insight into raw LLM calls.

**This is the best way to implement logging**: subscribe to all events by looping over the `EventName` enum and log the events as you see fit.

### Tools

Tools are asynchronous functions that take a structured input and return a string telling the API how to respond.

```ts
import { z } from "zod";
import { BaseTool } from "../../core/base-tool";

export class CountLettersTool extends BaseTool {
  public name = CountLettersTool.name;
  public description =
    "Count the number of times a letter appears in a word or phrase.";
  public schema = z.object({
    word: z
      .string()
      .describe("The word or phrase whose letters you want to count."),
    letter: z
      .string()
      .describe("The letter you want to count in the word or phrase."),
  });
  public handler({ word, letter }: z.infer<typeof this.schema>): string {
    const count = word.toLowerCase().split(letter.toLowerCase()).length - 1;
    return `There are ${count} "${letter.toUpperCase()}"s in "${word}".`;
  }
}
```

This example tool takes arguemnts for "word" and "letter" and returns an instruction for the AI to give an answer to the user. This simple function is not async, but it could be. The tool will also receive a "context" argument that will contain any arbitrary information you provide to the agent, such as the user information.

## Embeddings

The `TextEmbeddingGenerator` interface is simple to implement. There are 3 implementations provided here so far. The `OpenAiTextEmbeddingGenerator` uses OpenAI. `TitanTextEmbeddingGenerator` and `CohereTextEmbeddingGenerator` are provided here for Bedrock.

Generated embeddings are specific to the model, and the generator should always return the `modelId` as part of its response. But having a common, simple interface might allow you to swap in different embedding generators into your application and A/B test different models in your own vector store.

## Image generation

TBD

## Other model types

TBD

## Out of scope

A key goal is for Charlie to be simple and leave you in control. Some common features are out of scope

### Memory

"Memory" is generally out of scope. Providing memory to a chat prompt is generally as simple as providing an array of message objects. How those message objects are stored and then later loaded is an exercise for the consumer.

### Vector search

Similarly, "vector search" on its own is out of scope. This tool may be used to generate embeddings, but the consumer is responsible for storing them. The consumer may provide a vector search _tool_ to be called, but the behavior of such a tool is an exercise for the consumer.

### Post-processing and parsing

The output from an agent should be simple enough for you to perform any post-processing outside of the agent. It should not need to be embedded in the agent, though you can use the `Transformer`s to process LLM responses before and after tools are called.

### Text splitting

Generating text embeddings is in scope, but how the text is provided is not in scope for Charlie. When generating text embeddings for a large document, like a Wikipedia page, you should probably split the text into small logical chunks so that you produce multiple vectors that can surface that document in a search. Too much text will result in a vector that is too generic to provide good search results. It's not Charlie's job to split up the text for you! Have an LLM do it for you!

## Notes

[OpenAI's API](https://platform.openai.com/docs/api-reference/chat/create) includes tools as a parameter to the REST API. The prompt is an array of chat messages. In other words, free-form prompts are not supported and the format of the tool prompt is not exposed to the consumer. The legacy "[completions](https://platform.openai.com/docs/api-reference/completions)" endpoint is flagged as legacy and the documentation encourages using the Chat API instead. In other words, rolling your own prompt synthesis to support functions and chat messages is not recommended. This tool must be compatble with this structure.

On the flip side, with [Bedrock and Claude](https://medium.com/@zeek.granston/function-calling-with-anthropic-claude-and-amazon-bedrock-c6eda7358b0f), the function definition and prompt is not built in. [Similar source](https://medium.com/@daniellefranca96/running-a-langchain-agent-on-bedrock-claude-using-the-model-function-calling-5f400a8f0d62), but using LangChain and python to build the prompt.

NEW: Since writing the above, AWS has released the Converse API that does support chat history and tools, similar to OpenAI.
