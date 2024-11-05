import { AiChatAgent } from "./ai-chat-agent";
import { BaseTool } from "./base-tool";
import {
  ChatAgentGetResponseInput,
  ChatAgentGetResponseOutput,
  ChatExecutor,
  ChatMessage,
  MessageAssistant,
} from "./types";
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
    expr = expr.replaceAll(/[^0-9+\-*/\s]/, "");
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

class MockExecutor implements ChatExecutor {
  modelId = "mock-model-id";
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
      expect(responseMessage.content).toBe("The CalculatorTool tool said: 7");
      expect(response.responseMessages).toMatchSnapshot();
    });
  });
});
