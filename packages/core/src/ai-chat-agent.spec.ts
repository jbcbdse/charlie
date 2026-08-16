import { AiChatAgent } from "./ai-chat-agent";
import { BaseTool } from "./base-tool";
import {
  ChatAgentContext,
  ChatAgentGetResponseInput,
  ChatAgentGetResponseOutput,
  ChatExecutor,
  ChatExecutorInput,
  ChatMessage,
  MessageAssistant,
} from "./types";
import {
  EventName,
  EventProducer,
  EventTypeMap,
  eventProducer as globalEventProducer,
} from "./event-producer";
import { EventSubscriber } from "./event-subscriber";
import { z } from "zod";

class CalculatorTool extends BaseTool {
  public name = "CalculatorTool";
  public description =
    "Call this tool to perform any basic math. The input to this tool should be a valid mathematical expression that could be executed by a simple calculator. Only provide constants and operators";
  public schema = z.object({
    expr: z
      .string()
      .describe("A valid mathematical expression. Do not use variables."),
  });
  public handler({ expr }: z.TypeOf<typeof this.schema>): string {
    expr = expr.replaceAll(/[^0-9+\-*/\s]/g, "");
    try {
      const ans = eval(expr).toString();
      return `${expr} = ${ans}`;
    } catch (e) {
      throw new Error(
        "Invalid expression. Only provide numbers and operators without variables. You may try again",
      );
    }
  }
}

class PingPongTool extends BaseTool {
  public name = "PingPongTool";
  public description = "Call this tool if the user says the word 'ping'";
  public schema = z.object({});
  public returnDirect = true;
  public handler(): string {
    return "pong";
  }
}

class MockExecutor implements ChatExecutor {
  modelId = "mock-model-id";
  modelProvider = "mock-model-provider";
  execute = jest.fn(function (
    input: ChatAgentGetResponseInput,
  ): Promise<ChatAgentGetResponseOutput> {
    const message = input.messages[input.messages.length - 1];
    let responseMessage: ChatMessage = { role: "assistant", content: "Hello" };
    // mock what the LLM does when the user asks a question that requires a tool
    if (message.role === "user" && message.content === "Calculate 3 + 4") {
      const expr = message.content.replace("Calculate ", "");
      responseMessage = {
        role: "tool_call",
        toolCalls: [
          {
            function: {
              name: "CalculatorTool",
              arguments: { expr },
            },
            id: "toolcall1",
            type: "function",
          },
        ],
      };
    } else if (message.role === "user" && message.content.match(/ping/i)) {
      responseMessage = {
        role: "tool_call",
        toolCalls: [
          {
            function: { name: "PingPongTool", arguments: {} },
            id: "toolcall2",
            type: "function",
          },
        ],
      };
    } else if (message.role === "user") {
      responseMessage = {
        role: "assistant",
        content: `You said: ${message.content}`,
      };
    }
    if (message.role === "tool") {
      responseMessage = {
        role: "assistant",
        content: `The ${message.name} tool said: ${message.content}`,
      };
    }
    return Promise.resolve({
      responseMessage,
      responseMessages: [responseMessage],
    });
  });
}

describe("AiChatAgent", () => {
  let agent: AiChatAgent;
  let chatExecutor: ChatExecutor;
  beforeEach(() => {
    chatExecutor = new MockExecutor();
    agent = new AiChatAgent({
      chatExecutor,
    });
  });
  describe("getResponse", () => {
    it("should return a response message", async () => {
      const response = await agent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "Hey buddy" }],
        tools: [new CalculatorTool()],
      });
      const responseMessage = response.responseMessage as MessageAssistant;
      expect(responseMessage.role).toBe("assistant");
      expect(responseMessage.content).toBe("You said: Hey buddy");
    });
    it("should call a tool and return the response, along with intermediate steps including tool calls", async () => {
      const response = await agent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "Calculate 3 + 4" }],
        tools: [new CalculatorTool()],
      });
      const responseMessage = response.responseMessage as MessageAssistant;
      expect(responseMessage.role).toBe("assistant");
      expect(responseMessage.content).toBe(
        "The CalculatorTool tool said: 3 + 4 = 7",
      );
      expect(response.responseMessages).toMatchSnapshot();
    });
    it("should return the direct response from a tool where returnDirect is true", async () => {
      const response = await agent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "ping" }],
        tools: [new PingPongTool()],
      });
      const responseMessage = response.responseMessage as MessageAssistant;
      expect(responseMessage.role).toBe("assistant");
      expect(responseMessage.content).toBe("pong");
      expect(response.responseMessages).toMatchSnapshot();
    });
    it("lets a preRun transformer filter tools and mutate messages before execute", async () => {
      const keep = new PingPongTool();
      const drop = new CalculatorTool();
      const inputMessages: ChatMessage[] = [
        { role: "system", content: "ignore me" },
        { role: "user", content: "hey" },
      ];
      const inputTools = [keep, drop];
      const capturing = chatExecutor as MockExecutor;
      const started: ChatMessage[][] = [];
      const producer = new EventProducer();
      producer.emitter.on(EventName.ChatStart, (event) => {
        started.push(event.messages);
      });
      const localAgent = new AiChatAgent({
        chatExecutor: capturing,
        eventProducer: producer,
        preRunTransformers: [
          {
            async transform(messages, context) {
              await new Promise((resolve) => setTimeout(resolve, 20));
              context.tools = context.tools.filter(
                (tool) => tool.name === keep.name,
              );
              return messages.filter((message) => message.role === "user");
            },
          },
        ],
      });
      await localAgent.getResponse({
        messages: inputMessages,
        tools: inputTools,
      });
      expect(capturing.execute.mock.calls[0][0].tools).toEqual([keep]);
      expect(capturing.execute.mock.calls[0][0].messages).toEqual([
        { role: "user", content: "hey" },
      ]);
      expect(started).toEqual([[{ role: "user", content: "hey" }]]);
      expect(inputTools).toEqual([keep, drop]);
      expect(inputMessages).toEqual([
        { role: "system", content: "ignore me" },
        { role: "user", content: "hey" },
      ]);
    });
    it("passes undefined tools to execute when the caller omits them", async () => {
      const capturing = chatExecutor as MockExecutor;
      await agent.getResponse({
        messages: [{ role: "user", content: "hey" }],
      });
      expect(capturing.execute.mock.calls[0][0].tools).toBeUndefined();
    });
    it("runs preRun transformers once even when the tool loop continues", async () => {
      let preRunCalls = 0;
      const localAgent = new AiChatAgent({
        chatExecutor,
        preRunTransformers: [
          {
            transform(messages) {
              preRunCalls += 1;
              return messages;
            },
          },
        ],
      });
      await localAgent.getResponse({
        messages: [{ role: "user", content: "Calculate 3 + 4" }],
        tools: [new CalculatorTool()],
      });
      expect(preRunCalls).toBe(1);
      expect((chatExecutor as MockExecutor).execute.mock.calls.length).toBe(2);
    });
    it("uses context.tools mutated by a postToolCall transformer on the next executor call", async () => {
      const seen: Array<string[] | undefined> = [];
      const inputTools = [new CalculatorTool()];
      const inputMessages: ChatMessage[] = [
        { role: "user", content: "Calculate 3 + 4" },
      ];
      const executor: ChatExecutor = {
        modelId: "mock-model-id",
        modelProvider: "mock-model-provider",
        execute: jest.fn(async (input: ChatExecutorInput) => {
          seen.push(input.tools?.map((tool) => tool.name));
          const last = input.messages[input.messages.length - 1];
          if (last.role === "user") {
            const responseMessage: ChatMessage = {
              role: "tool_call",
              toolCalls: [
                {
                  id: "toolcall1",
                  type: "function",
                  function: {
                    name: "CalculatorTool",
                    arguments: { expr: "3 + 4" },
                  },
                },
              ],
            };
            return {
              responseMessage,
              responseMessages: [responseMessage],
            };
          }
          const responseMessage: ChatMessage = {
            role: "assistant",
            content: "done",
          };
          return { responseMessage, responseMessages: [responseMessage] };
        }),
      };
      const localAgent = new AiChatAgent({
        chatExecutor: executor,
        postToolCallTransformers: [
          {
            transform(messages, context) {
              context.tools = [];
              return messages;
            },
          },
        ],
      });
      const response = await localAgent.getResponse({
        messages: inputMessages,
        tools: inputTools,
      });
      expect(seen).toEqual([["CalculatorTool"], undefined]);
      expect(response.responseMessage).toEqual({
        role: "assistant",
        content: "done",
      });
      expect(inputTools).toHaveLength(1);
      expect(inputMessages).toEqual([
        { role: "user", content: "Calculate 3 + 4" },
      ]);
    });
  });

  describe("eventProducer injection", () => {
    // MockExecutor that also emits ChatRawRequest / ChatRawResponse via the
    // context-supplied producer, so we can validate executor-side wiring end
    // to end without depending on a real LLM SDK.
    class RawEmittingMockExecutor implements ChatExecutor {
      modelId = "mock-model-id";
      modelProvider = "mock-model-provider";
      public capturedContexts: ChatExecutorInput["context"][] = [];
      execute = jest.fn(
        async (
          input: ChatExecutorInput,
        ): Promise<ChatAgentGetResponseOutput> => {
          this.capturedContexts.push(input.context);
          input.context.eventProducer.emit(EventName.ChatRawRequest, {
            context: input.context,
            modelId: this.modelId,
            request: { fake: "request" },
          });
          const last = input.messages[input.messages.length - 1];
          let responseMessage: ChatMessage = {
            role: "assistant",
            content: "Hello",
          };
          if (last.role === "user" && last.content === "Calculate 3 + 4") {
            responseMessage = {
              role: "tool_call",
              toolCalls: [
                {
                  function: {
                    name: "CalculatorTool",
                    arguments: { expr: "3 + 4" },
                  },
                  id: "toolcall1",
                  type: "function",
                },
              ],
            };
          } else if (last.role === "user" && /ping/i.test(last.content)) {
            responseMessage = {
              role: "tool_call",
              toolCalls: [
                {
                  function: { name: "PingPongTool", arguments: {} },
                  id: "toolcall2",
                  type: "function",
                },
              ],
            };
          } else if (last.role === "user") {
            responseMessage = {
              role: "assistant",
              content: `You said: ${last.content}`,
            };
          } else if (last.role === "tool") {
            responseMessage = {
              role: "assistant",
              content: `The ${last.name} tool said: ${last.content}`,
            };
          }
          input.context.eventProducer.emit(EventName.ChatRawResponse, {
            context: input.context,
            modelId: this.modelId,
            response: { fake: "response" },
            timeMs: 0,
          });
          return {
            responseMessage,
            responseMessages: [responseMessage],
          };
        },
      );
    }

    function recordAllEvents(producer: EventProducer): string[] {
      const seen: string[] = [];
      for (const name of Object.values(EventName)) {
        producer.emitter.on(name, () => seen.push(name));
      }
      return seen;
    }

    let globalBaseline: Record<string, number>;

    beforeEach(() => {
      globalBaseline = Object.fromEntries(
        Object.values(EventName).map((n) => [
          n,
          globalEventProducer.emitter.listenerCount(n),
        ]),
      );
    });

    it("defaults to the global eventProducer when none is passed", async () => {
      const subscriber = new EventSubscriber();
      const heard: EventTypeMap[EventName.ChatStart][] = [];
      const listener = (ev: EventTypeMap[EventName.ChatStart]): void => {
        heard.push(ev);
      };
      subscriber.on(EventName.ChatStart, listener);
      try {
        const localAgent = new AiChatAgent({
          chatExecutor: new RawEmittingMockExecutor(),
        });
        await localAgent.getResponse({
          meta: {},
          messages: [{ role: "user", content: "Hey buddy" }],
        });
        expect(heard).toHaveLength(1);
      } finally {
        subscriber.off(EventName.ChatStart, listener);
      }
    });

    it("routes all agent-emitted events to the injected producer only", async () => {
      const producer = new EventProducer();
      const injected = recordAllEvents(producer);
      const localAgent = new AiChatAgent({
        chatExecutor: new RawEmittingMockExecutor(),
        eventProducer: producer,
      });
      await localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "Hey buddy" }],
      });
      // No tool path → ChatStart, ChatExecutorStart, ChatRawRequest,
      // ChatRawResponse, ChatExecutorEnd, ChatEnd.
      expect(injected).toEqual([
        EventName.ChatStart,
        EventName.ChatExecutorStart,
        EventName.ChatRawRequest,
        EventName.ChatRawResponse,
        EventName.ChatExecutorEnd,
        EventName.ChatEnd,
      ]);
      // Global listener counts unchanged → no cross-pollution.
      for (const n of Object.values(EventName)) {
        expect(globalEventProducer.emitter.listenerCount(n)).toBe(
          globalBaseline[n],
        );
      }
    });

    it("attaches the injected producer to ChatAgentContext", async () => {
      const producer = new EventProducer();
      const executor = new RawEmittingMockExecutor();
      const localAgent = new AiChatAgent({
        chatExecutor: executor,
        eventProducer: producer,
      });
      await localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "Hey buddy" }],
      });
      expect(executor.capturedContexts).toHaveLength(1);
      expect(executor.capturedContexts[0].eventProducer).toBe(producer);
    });

    it("emits the full ordered event sequence for a tool-calling flow", async () => {
      const producer = new EventProducer();
      const ordered = recordAllEvents(producer);
      const localAgent = new AiChatAgent({
        chatExecutor: new RawEmittingMockExecutor(),
        eventProducer: producer,
      });
      await localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "Calculate 3 + 4" }],
        tools: [new CalculatorTool()],
      });
      expect(ordered).toEqual([
        EventName.ChatStart,
        EventName.ChatExecutorStart,
        EventName.ChatRawRequest,
        EventName.ChatRawResponse,
        EventName.ChatExecutorEnd,
        EventName.ToolsStart,
        EventName.ToolStart,
        EventName.ToolEnd,
        EventName.ToolsEnd,
        EventName.ChatExecutorStart,
        EventName.ChatRawRequest,
        EventName.ChatRawResponse,
        EventName.ChatExecutorEnd,
        EventName.ChatEnd,
      ]);
    });

    it("still emits ChatEnd on a returnDirect short-circuit", async () => {
      const producer = new EventProducer();
      const ordered = recordAllEvents(producer);
      const localAgent = new AiChatAgent({
        chatExecutor: new RawEmittingMockExecutor(),
        eventProducer: producer,
      });
      await localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "ping" }],
        tools: [new PingPongTool()],
      });
      expect(ordered).toEqual([
        EventName.ChatStart,
        EventName.ChatExecutorStart,
        EventName.ChatRawRequest,
        EventName.ChatRawResponse,
        EventName.ChatExecutorEnd,
        EventName.ToolsStart,
        EventName.ToolStart,
        EventName.ToolEnd,
        EventName.ToolsEnd,
        EventName.ChatEnd,
      ]);
    });

    it("captures ToolProgress and Log events emitted by a tool", async () => {
      class ProgressEmittingTool extends BaseTool {
        public name = "ProgressEmittingTool";
        public description =
          "A tool that emits ToolProgress and Log events while running";
        public schema = z.object({});
        public handler(
          _params: z.infer<typeof this.schema>,
          context: import("./types").ChatAgentContext,
        ): string {
          context.eventProducer.emit(EventName.Log, {
            context,
            level: "info",
            message: "starting work",
            meta: { phase: "init" },
          });
          context.eventProducer.emit(EventName.ToolProgress, {
            context,
            message: "halfway",
          });
          context.eventProducer.emit(EventName.Log, {
            context,
            level: "debug",
            message: "finished work",
            meta: { phase: "done", count: 42 },
          });
          return "done";
        }
      }

      // Pre-stage a mock that calls the ProgressEmittingTool, then on the
      // follow-up turn returns a normal assistant message.
      class ProgressMockExecutor implements ChatExecutor {
        modelId = "mock-model-id";
        modelProvider = "mock-model-provider";
        async execute(
          input: ChatExecutorInput,
        ): Promise<ChatAgentGetResponseOutput> {
          const last = input.messages[input.messages.length - 1];
          if (last.role === "tool") {
            const msg: ChatMessage = { role: "assistant", content: "done" };
            return { responseMessage: msg, responseMessages: [msg] };
          }
          const msg: ChatMessage = {
            role: "tool_call",
            toolCalls: [
              {
                function: {
                  name: "ProgressEmittingTool",
                  arguments: {},
                },
                id: "progress-1",
                type: "function",
              },
            ],
          };
          return { responseMessage: msg, responseMessages: [msg] };
        }
      }

      const producer = new EventProducer();
      const progress: EventTypeMap[EventName.ToolProgress][] = [];
      const logs: EventTypeMap[EventName.Log][] = [];
      producer.emitter.on(EventName.ToolProgress, (ev) => progress.push(ev));
      producer.emitter.on(EventName.Log, (ev) => logs.push(ev));

      const localAgent = new AiChatAgent({
        chatExecutor: new ProgressMockExecutor(),
        eventProducer: producer,
      });
      await localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "go" }],
        tools: [new ProgressEmittingTool()],
      });

      expect(progress.map((p) => p.message)).toEqual(["halfway"]);
      expect(logs.map((l) => ({ level: l.level, message: l.message }))).toEqual(
        [
          { level: "info", message: "starting work" },
          { level: "debug", message: "finished work" },
        ],
      );
      expect(logs[1].meta).toEqual({ phase: "done", count: 42 });
    });
  });

  describe("systemPrompt on context", () => {
    // Capturing mock: records what context.systemPrompt looked like on each
    // executor call, then drives the agent through one tool turn so we can
    // verify the re-serialization-per-iteration semantics.
    class CapturingMockExecutor implements ChatExecutor {
      modelId = "mock-model-id";
      modelProvider = "mock-model-provider";
      public seenSystemPrompts: (string | undefined)[] = [];
      execute = jest.fn(
        async (
          input: ChatExecutorInput,
        ): Promise<ChatAgentGetResponseOutput> => {
          this.seenSystemPrompts.push(input.context.systemPrompt);
          const last = input.messages[input.messages.length - 1];
          if (last.role === "tool") {
            const msg: ChatMessage = {
              role: "assistant",
              content: "ok",
            };
            return { responseMessage: msg, responseMessages: [msg] };
          }
          const msg: ChatMessage = {
            role: "tool_call",
            toolCalls: [
              {
                function: { name: "BumpCounterTool", arguments: {} },
                id: "bump-1",
                type: "function",
              },
            ],
          };
          return { responseMessage: msg, responseMessages: [msg] };
        },
      );
    }

    class BumpCounterTool extends BaseTool {
      public name = "BumpCounterTool";
      public description =
        "Increments a counter stored in context.meta so the next template " +
        "serialization picks up a different value.";
      public schema = z.object({});
      public handler(
        _params: z.infer<typeof this.schema>,
        context: import("./types").ChatAgentContext,
      ): string {
        context.meta.counter = ((context.meta.counter as number) || 0) + 1;
        return "bumped";
      }
    }

    it("attaches the serialized system prompt to context on every iteration", async () => {
      const executor = new CapturingMockExecutor();
      const localAgent = new AiChatAgent({
        chatExecutor: executor,
        systemPromptTemplate: "Counter is {{counter}}",
      });
      await localAgent.getResponse({
        meta: { counter: 7 },
        messages: [{ role: "user", content: "go" }],
        tools: [new BumpCounterTool()],
      });
      // Two executor calls: initial + post-tool. The counter bumped between
      // them, so the serialized prompt should differ.
      expect(executor.seenSystemPrompts).toEqual([
        expect.stringContaining("Counter is 7"),
        expect.stringContaining("Counter is 8"),
      ]);
    });

    it("leaves context.systemPrompt undefined when no template is configured", async () => {
      const executor = new CapturingMockExecutor();
      const localAgent = new AiChatAgent({ chatExecutor: executor });
      await localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "go" }],
        tools: [new BumpCounterTool()],
      });
      expect(executor.seenSystemPrompts).toEqual([undefined, undefined]);
    });

    it("re-serializes the template on the next iteration, reflecting tool template mutations", async () => {
      // A tool that mutates context.systemPromptTemplate. The next
      // iteration must serialize the new template, proving that template
      // mutations are respected.
      class HijackPromptTool extends BaseTool {
        public name = "HijackPromptTool";
        public description = "Overwrites context.systemPromptTemplate mid-run.";
        public schema = z.object({});
        public handler(
          _params: z.infer<typeof this.schema>,
          context: import("./types").ChatAgentContext,
        ): string {
          context.systemPromptTemplate = "HIJACKED";
          return "hijacked";
        }
      }
      class HijackMockExecutor implements ChatExecutor {
        modelId = "mock-model-id";
        modelProvider = "mock-model-provider";
        public seen: (string | undefined)[] = [];
        async execute(
          input: ChatExecutorInput,
        ): Promise<ChatAgentGetResponseOutput> {
          this.seen.push(input.context.systemPrompt);
          const last = input.messages[input.messages.length - 1];
          if (last.role === "tool") {
            const msg: ChatMessage = {
              role: "assistant",
              content: "done",
            };
            return { responseMessage: msg, responseMessages: [msg] };
          }
          const msg: ChatMessage = {
            role: "tool_call",
            toolCalls: [
              {
                function: { name: "HijackPromptTool", arguments: {} },
                id: "hi-1",
                type: "function",
              },
            ],
          };
          return { responseMessage: msg, responseMessages: [msg] };
        }
      }
      const executor = new HijackMockExecutor();
      const localAgent = new AiChatAgent({
        chatExecutor: executor,
        systemPromptTemplate: "Template prompt",
      });
      await localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "go" }],
        tools: [new HijackPromptTool()],
      });
      expect(executor.seen).toEqual([
        expect.stringContaining("Template prompt"),
        expect.stringContaining("HIJACKED"),
      ]);
      // The second iteration should use the hijacked template.
      expect(executor.seen[1]).toBe("HIJACKED");
    });
  });

  describe("ChatRun", () => {
    class StreamingMockExecutor implements ChatExecutor {
      modelId = "stream-model";
      modelProvider = "stream-provider";
      constructor(private slices: string[]) {}
      async execute(
        input: ChatExecutorInput,
      ): Promise<ChatAgentGetResponseOutput> {
        for (const text of this.slices) {
          input.context.eventProducer.emit(EventName.ChatStreamChunk, {
            context: input.context,
            modelId: this.modelId,
            modelProvider: this.modelProvider,
            chunk: { type: "text", text },
          });
        }
        const responseMessage: ChatMessage = {
          role: "assistant",
          content: this.slices.join(""),
        };
        return {
          responseMessage,
          responseMessages: [responseMessage],
        };
      }
    }

    class ProgressTool extends BaseTool {
      public name = "ProgressTool";
      public description = "Emits progress";
      public schema = z.object({});
      public returnDirect = true;
      public handler(
        _params: z.TypeOf<typeof this.schema>,
        context: ChatAgentContext,
      ): string {
        context.eventProducer.emit(EventName.ToolProgress, {
          context,
          message: "working",
        });
        context.eventProducer.emit(EventName.Log, {
          context,
          message: "logged",
          level: "info",
          meta: {},
        });
        return "ok";
      }
    }

    class ProgressMockExecutor implements ChatExecutor {
      modelId = "progress-model";
      modelProvider = "progress-provider";
      async execute(): Promise<ChatAgentGetResponseOutput> {
        const responseMessage: ChatMessage = {
          role: "tool_call",
          toolCalls: [
            {
              function: { name: "ProgressTool", arguments: {} },
              id: "progress-1",
              type: "function",
            },
          ],
        };
        return {
          responseMessage,
          responseMessages: [responseMessage],
        };
      }
    }

    it("is thenable and returns the same result as await", async () => {
      const localAgent = new AiChatAgent({
        chatExecutor: new StreamingMockExecutor(["Hel", "lo"]),
      });
      const run = localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "hi" }],
      });
      expect(typeof run.then).toBe("function");
      const result = await run;
      expect(result.responseMessage).toEqual({
        role: "assistant",
        content: "Hello",
      });
    });

    it("scopes .on listeners to the runId", async () => {
      const producer = new EventProducer();
      const runA = new AiChatAgent({
        chatExecutor: new StreamingMockExecutor(["A1", "A2"]),
        eventProducer: producer,
      }).getResponse({
        meta: {},
        messages: [{ role: "user", content: "a" }],
      });
      const runB = new AiChatAgent({
        chatExecutor: new StreamingMockExecutor(["B1"]),
        eventProducer: producer,
      }).getResponse({
        meta: {},
        messages: [{ role: "user", content: "b" }],
      });
      const heardA: string[] = [];
      const heardB: string[] = [];
      runA.on(EventName.ChatStreamChunk, ({ chunk }) => {
        if (chunk.type === "text") heardA.push(chunk.text);
      });
      runB.on(EventName.ChatStreamChunk, ({ chunk }) => {
        if (chunk.type === "text") heardB.push(chunk.text);
      });
      await Promise.all([runA, runB]);
      expect(heardA).toEqual(["A1", "A2"]);
      expect(heardB).toEqual(["B1"]);
    });

    it("async-iterates chunks then stops", async () => {
      const localAgent = new AiChatAgent({
        chatExecutor: new StreamingMockExecutor(["one", "two"]),
      });
      const run = localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "hi" }],
      });
      const texts: string[] = [];
      for await (const { chunk } of run) {
        if (chunk.type === "text") texts.push(chunk.text);
      }
      expect(texts).toEqual(["one", "two"]);
      const result = await run;
      expect((result.responseMessage as MessageAssistant).content).toBe(
        "onetwo",
      );
    });

    it("does not reject the run when a listener throws", async () => {
      const localAgent = new AiChatAgent({
        chatExecutor: new StreamingMockExecutor(["ok"]),
      });
      const run = localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "hi" }],
      });
      run.on(EventName.ChatStreamChunk, () => {
        throw new Error("consumer fault");
      });
      await expect(run).resolves.toMatchObject({
        responseMessage: { role: "assistant", content: "ok" },
      });
    });

    it("replaces a duplicate .on registration instead of leaking", async () => {
      const producer = new EventProducer();
      const localAgent = new AiChatAgent({
        chatExecutor: new StreamingMockExecutor(["x"]),
        eventProducer: producer,
      });
      const run = localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "hi" }],
      });
      const heard: string[] = [];
      const listener = (): void => {
        heard.push("hit");
      };
      run.on(EventName.ChatStreamChunk, listener);
      run.on(EventName.ChatStreamChunk, listener);
      await run;
      expect(heard).toEqual(["hit"]);
      expect(producer.emitter.listenerCount(EventName.ChatStreamChunk)).toBe(0);
    });

    it("ignores .on after the run settles", async () => {
      const producer = new EventProducer();
      const localAgent = new AiChatAgent({
        chatExecutor: new StreamingMockExecutor(["ok"]),
        eventProducer: producer,
      });
      const run = localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "hi" }],
      });
      await run;
      run.on(EventName.ChatStreamChunk, () => undefined);
      expect(producer.emitter.listenerCount(EventName.ChatStreamChunk)).toBe(0);
    });

    it("stamps toolName and toolCallId on ToolProgress and Log", async () => {
      const producer = new EventProducer();
      const localAgent = new AiChatAgent({
        chatExecutor: new ProgressMockExecutor(),
        eventProducer: producer,
      });
      const run = localAgent.getResponse({
        meta: {},
        messages: [{ role: "user", content: "go" }],
        tools: [new ProgressTool()],
      });
      const progress: EventTypeMap[EventName.ToolProgress][] = [];
      const logs: EventTypeMap[EventName.Log][] = [];
      run.on(EventName.ToolProgress, (event) => {
        progress.push(event);
      });
      run.on(EventName.Log, (event) => {
        logs.push(event);
      });
      await run;
      expect(progress).toHaveLength(1);
      expect(progress[0].message).toBe("working");
      expect(progress[0].toolName).toBe("ProgressTool");
      expect(progress[0].toolCallId).toBe("progress-1");
      expect(logs).toHaveLength(1);
      expect(logs[0].toolName).toBe("ProgressTool");
      expect(logs[0].toolCallId).toBe("progress-1");
    });
  });
});
