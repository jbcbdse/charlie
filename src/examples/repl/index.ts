/* eslint-disable no-console */
import repl from "node:repl";
import { AiChatAgent } from "../../core/ai-chat-agent";
import { ChatAgent, ChatMessage, MessageUser } from "../../core/types";
import { CountLettersTool } from "../../tools/letter-count.tool";
import { CurrentTimeTool } from "../../tools/current-time.tool";
import { OpenAiChatExecutor } from "../../openai/openai-chat-executor";
import { setTimeout as sleep } from "timers/promises";
import { CalculatorTool } from "../../tools/calculator.tool";
import { BedrockChatExecutor } from "../../bedrock/bedrock-chat-executor";
import { InlineToolCallParser } from "../../bedrock/inline-tool-call-parser";
import { ToolAssistantFilter } from "../../core/tool-assistant-filter";
import { EventName, events } from "../../core";

events.on(EventName.ChatRawRequest, (data) => {
  console.debug("ChatRawRequest", JSON.stringify(data, null, 2));
});
const promptTemplate = [
  "You are a helpful but rude, sarcastic assistant, but keep it PG-13. Use 1 emoji in every response",
  "",
  "You know this information about the user:",
  "{{user}}",
].join("\n");
const bedrockPreToolCallTransformers = [
  new InlineToolCallParser(),
  new ToolAssistantFilter(),
];
type AvailableAgent =
  | "claude"
  | "mistral"
  | "commandR"
  | "llama3"
  | "titan"
  | "gpt4o"
  | "gpto1";
const agents: Record<AvailableAgent, ChatAgent> = {
  claude: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "anthropic.claude-3-haiku-20240307-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: bedrockPreToolCallTransformers,
  }),
  mistral: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "mistral.mistral-large-2402-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: bedrockPreToolCallTransformers,
  }),
  commandR: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "cohere.command-r-plus-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: bedrockPreToolCallTransformers,
  }),
  llama3: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "meta.llama3-70b-instruct-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: bedrockPreToolCallTransformers,
  }),
  titan: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "amazon.titan-text-premier-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: bedrockPreToolCallTransformers,
  }),

  gpt4o: new AiChatAgent({
    chatExecutor: new OpenAiChatExecutor({
      modelId: "gpt-4o",
      apiKey: process.env.OPENAI_API_KEY!,
    }),
    systemPromptTemplate: promptTemplate,
  }),
  gpto1: new AiChatAgent({
    chatExecutor: new OpenAiChatExecutor({
      modelId: "o1-preview",
      apiKey: process.env.OPENAI_API_KEY!,
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
let currentAgent: AvailableAgent = "gpt4o";

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
        },
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
