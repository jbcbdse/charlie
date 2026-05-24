import { AiChatAgent } from "./ai-chat-agent";
import { BaseTool } from "./base-tool";
import {
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
  });
});
