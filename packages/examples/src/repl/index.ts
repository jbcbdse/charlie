/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable no-console */
import {
  AiChatAgent,
  ChatAgent,
  ChatMessage,
  EventName,
  MessageTool,
  MessageToolCall,
  MessageUser,
  ToolAssistantFilter,
  events,
} from "@ifit/charlie-core";
import {
  BedrockChatExecutor,
  InlineToolCallParser,
} from "@ifit/charlie-bedrock";
import { CalculatorTool } from "../tools/calculator.tool";
import { CountLettersTool } from "../tools/letter-count.tool";
import { CurrentTimeTool } from "../tools/current-time.tool";
import { GeminiExecutor } from "@ifit/charlie-google";
import { OpenAiChatExecutor } from "@ifit/charlie-openai";
import repl from "node:repl";
import { setTimeout as sleep } from "timers/promises";

events.on(EventName.ToolStart, (data) => {
  // console.debug(EventName.ChatRawRequest, JSON.stringify(data, null, 2));
  console.dir((data.toolCall as MessageToolCall).toolCalls, { depth: null });
});
events.on(EventName.ToolsEnd, (data) => {
  data.toolMessages.forEach((toolMessage, index) => {
    console.log(
      `[Tool result ${index + 1}] ${(toolMessage as MessageTool).content}`,
    );
  });
});
events.on(EventName.ChatEnd, (data) => {
  console.dir(data.messages, { depth: null });
  console.log(data.modelId, "complete");
});
// events.on(EventName.ChatRawResponse, (data) => {
//   // console.debug(EventName.ChatRawResponse, JSON.stringify(data, null, 2));
// });
const promptTemplate = [
  "You are a helpful but rude, sarcastic assistant, but keep it PG-13. Use 1 emoji in every response",
  "",
  "If the user asks what the available agents are, they are {{availableAgents}}",
  "",
  "You know this information about the user:",
  "{{user}}",
].join("\n");
const toolAssistantFilter = new ToolAssistantFilter();
const inlineToolCallParser = new InlineToolCallParser();
type AvailableAgent =
  | "claude"
  | "mistral"
  | "commandr"
  | "llama"
  | "jamba-large"
  | "nova"
  | "titan"
  | "gpt4o"
  | "gemini";
const agents: Record<AvailableAgent, ChatAgent> = {
  claude: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
  }),
  mistral: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "mistral.mistral-large-2402-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
  }),
  commandr: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "cohere.command-r-plus-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
  }),
  llama: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.meta.llama3-2-90b-instruct-v1:0",
      // "us.meta.llama3-1-70b-instruct-v1:0"
      // "us.meta.llama3-2-90b-instruct-v1:0"
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
  }),
  "jamba-large": new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "ai21.jamba-1-5-large-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
  }),
  nova: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.amazon.nova-lite-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
  }),
  titan: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "amazon.titan-text-premier-v1:0",
      toolsSupported: false,
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [inlineToolCallParser, toolAssistantFilter],
  }),
  gpt4o: new AiChatAgent({
    chatExecutor: new OpenAiChatExecutor({
      modelId: "gpt-4o-mini",
      apiKey: process.env.OPENAI_API_KEY!,
    }),
    systemPromptTemplate: promptTemplate,
  }),
  gemini: new AiChatAgent({
    chatExecutor: new GeminiExecutor({
      modelId: "gemini-1.5-flash",
      apiKey: process.env.GOOGLE_API_KEY!,
    }),
    systemPromptTemplate: promptTemplate,
  }),
};
const tools = [
  new CountLettersTool(),
  new CurrentTimeTool(),
  new CalculatorTool(),
];
const messageHistory: ChatMessage[] = [];
const availableAgents: AvailableAgent[] = Object.keys(
  agents,
) as AvailableAgent[];
let currentAgent: AvailableAgent = "claude";

async function handleChat(input: string): Promise<string> {
  const userMessage: MessageUser = {
    role: "user",
    content: input,
  };
  messageHistory.push(userMessage);
  const response = await agents[currentAgent]
    .getResponse({
      messages: messageHistory,
      tools: tools,
      meta: {
        user: {
          first_name: "Jonathan",
          last_name: "Barnett",
          preferred_name: "Jon",
        },
        availableAgents,
      },
    })
    .catch((err) => {
      console.error(err, err?.response?.data);
      return {
        responseMessage: {
          role: "assistant" as const,
          content: "An error occurred",
        },
        responseMessages: [
          {
            role: "assistant" as const,
            content: "An error occurred",
          },
        ],
      };
    });
  const outputString = response.responseMessages
    .filter((msg) => msg.role === "assistant")
    .map((msg) => msg.content)
    .join("\n");
  // only remember assistant messages for history
  messageHistory.push(
    ...response.responseMessages.filter((msg) => msg.role === "assistant"),
  );
  return outputString;
}

function handleUse(cmd: string): string | null {
  if (
    Object.keys(agents)
      .map((a) => `use ${a}`)
      .includes(cmd)
  ) {
    const agentKey = cmd.split(" ")[1] as AvailableAgent;
    if (!availableAgents.includes(agentKey)) {
      return `Agent ${agentKey} is not available`;
    }
    currentAgent = agentKey;
    return `Switched to agent ${agentKey}`;
  }
  return null;
}

function handleClear(cmd: string): string | null {
  if (cmd === "clear") {
    messageHistory.length = 0;
    return "Message history cleared";
  }
  return null;
}

async function handleCmd(cmd: string): Promise<string | null> {
  cmd = cmd.trim();
  if (cmd === "") {
    return null;
  }
  const response =
    (await handleUse(cmd)) ||
    (await handleClear(cmd)) ||
    (await handleChat(cmd));
  return response;
}

async function startRepl() {
  await sleep(1);
  console.log("Welcome to the chatbot REPL");
  console.log(`Using agent ${currentAgent}`);
  console.log("Type use <agent> to switch agents");
  console.log(`The available agents are ${availableAgents.join(", ")}`);
  const r = repl.start({
    prompt: "> ",
    eval: async (cmd, context, filename, cb) => {
      const response = await handleCmd(cmd);
      if (response !== null) {
        r.output.write(response + "\n");
      }
      cb(null, undefined);
    },
    ignoreUndefined: true,
  });
}

startRepl();
