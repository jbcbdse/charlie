/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable no-console */
import {
  AiChatAgent,
  ChatAgent,
  ChatMessage,
  EventName,
  EventProducer,
  EventSubscriber,
  MessageUser,
  ToolAssistantFilter,
} from "@jbcbdse/charlie-core";
import {
  BedrockChatExecutor,
  InlineToolCallParser,
} from "@jbcbdse/charlie-bedrock";
import { CalculatorTool } from "../tools/calculator.tool";
import { CountLettersTool } from "../tools/letter-count.tool";
import { CurrentTimeTool } from "../tools/current-time.tool";
import { GeminiExecutor } from "@jbcbdse/charlie-google";
import { GrokExecutor, OpenAiChatExecutor } from "@jbcbdse/charlie-openai";
import {
  BedrockMantleExecutor,
  BedrockMantleMessagesExecutor,
  BedrockMantleResponsesExecutor,
  bedrockMantleBaseURL,
} from "@jbcbdse/charlie-bedrock-mantle";
import { OllamaExecutor } from "@jbcbdse/charlie-ollama";
import repl from "node:repl";
import { setTimeout as sleep } from "timers/promises";
import { LlmSpansApi } from "@jbcbdse/charlie-datadog";
import dotenv from "dotenv";
import { DirectBirthdayTool } from "../tools/direct-birthday.tool";
import { DeleteAccountTool } from "../tools/delete-account.tool";
dotenv.config({ path: "../../.env" });

const appEventProducer = new EventProducer();
const appEvents = new EventSubscriber(appEventProducer);

appEvents.on(EventName.ToolStart, (data) => {
  // console.debug(EventName.ChatRawRequest, JSON.stringify(data, null, 2));
  console.dir(data.toolCall.toolCalls, { depth: null });
});
appEvents.on(EventName.ToolsEnd, (data) => {
  data.toolMessages.forEach((toolMessage, index) => {
    console.log(`[Tool result ${index + 1}] ${toolMessage.content}`);
  });
});
appEvents.on(EventName.ChatEnd, (data) => {
  console.log(data.modelId, "complete");
});
appEvents.on(EventName.ToolProgress, (data) => {
  console.log(`[progress] ${data.message}`);
});
appEvents.on(EventName.Log, (data) => {
  console.log(`[${data.level}] ${data.message}`, data.meta);
});
if (process.env.DD_API_KEY) {
  new LlmSpansApi({
    apiKey: process.env.DD_API_KEY!,
    tags: {
      service: "charlie",
      env: "dev",
    },
  }).listen(appEvents);
}
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
  | "grok"
  | "gemini"
  | "mantle-gpt-oss"
  | "mantle-deepseek"
  | "mantle-glm"
  | "mantle-grok"
  | "mantle-gpt-oss-responses"
  | "mantle-grok-responses"
  | "mantle-gpt-5"
  | "mantle-claude"
  | "ollama";
const agents: Record<AvailableAgent, ChatAgent> = {
  claude: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.anthropic.claude-sonnet-4-6",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  mistral: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "mistral.mistral-large-3-675b-instruct",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  commandr: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.meta.llama4-scout-17b-instruct-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  llama: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.meta.llama3-3-70b-instruct-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  "jamba-large": new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "ai21.jamba-1-5-large-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  nova: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.amazon.nova-2-lite-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  titan: new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.amazon.nova-micro-v1:0",
      toolsSupported: false,
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [inlineToolCallParser, toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  gpt4o: new AiChatAgent({
    chatExecutor: new OpenAiChatExecutor({
      modelId: "o4-mini",
      apiKey: process.env.OPENAI_API_KEY!,
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  grok: new AiChatAgent({
    chatExecutor: new GrokExecutor({
      modelId: "grok-4.3",
      apiKey: process.env.XAI_API_KEY!,
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  gemini: new AiChatAgent({
    chatExecutor: new GeminiExecutor({
      modelId: "gemini-2.5-flash",
      apiKey: process.env.GOOGLE_API_KEY!,
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  // Bedrock Mantle (OpenAI-compatible). Claude on Mantle uses Messages API, not Chat Completions.
  "mantle-gpt-oss": new AiChatAgent({
    chatExecutor: new BedrockMantleExecutor({
      modelId: "openai.gpt-oss-20b",
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "mantle-deepseek": new AiChatAgent({
    chatExecutor: new BedrockMantleExecutor({
      modelId: "deepseek.v3.2",
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "mantle-glm": new AiChatAgent({
    chatExecutor: new BedrockMantleExecutor({
      modelId: "zai.glm-4.7-flash",
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "mantle-grok": new AiChatAgent({
    chatExecutor: new BedrockMantleExecutor({
      modelId: "xai.grok-4.3",
      baseURL: bedrockMantleBaseURL("openai/v1"),
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "mantle-gpt-oss-responses": new AiChatAgent({
    chatExecutor: new BedrockMantleResponsesExecutor({
      modelId: "openai.gpt-oss-20b",
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "mantle-grok-responses": new AiChatAgent({
    chatExecutor: new BedrockMantleResponsesExecutor({
      modelId: "xai.grok-4.3",
      baseURL: bedrockMantleBaseURL("openai/v1"),
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "mantle-gpt-5": new AiChatAgent({
    chatExecutor: new BedrockMantleResponsesExecutor({
      modelId: "openai.gpt-5.6-luna",
      baseURL: bedrockMantleBaseURL("openai/v1"),
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "mantle-claude": new AiChatAgent({
    chatExecutor: new BedrockMantleMessagesExecutor({
      modelId: "anthropic.claude-haiku-4-5",
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  ollama: new AiChatAgent({
    chatExecutor: new OllamaExecutor({
      modelId: "qwen3.6:35b-a3b",
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
};
const tools = [
  new CountLettersTool(),
  new CurrentTimeTool(),
  new CalculatorTool(),
  new DirectBirthdayTool(),
  new DeleteAccountTool(),
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
  try {
    const run = agents[currentAgent].getResponse({
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
    });
    run.on(EventName.ChatStreamChunk, ({ chunk }) => {
      if (chunk.type === "text") {
        process.stdout.write(chunk.text);
      }
      if (chunk.type === "thinking") {
        process.stderr.write(chunk.text);
      }
    });
    const response = await run;
    process.stdout.write("\n");
    messageHistory.push(
      ...response.responseMessages.filter(
        (msg) => msg.role === "assistant" || msg.role === "reasoning",
      ),
    );
    return "";
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.error(err, (err as any)?.response?.data);
    return "An error occurred";
  }
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
