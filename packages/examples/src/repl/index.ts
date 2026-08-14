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
import { BedrockMantleExecutor } from "@jbcbdse/charlie-bedrock-mantle";
import { OllamaExecutor } from "@jbcbdse/charlie-ollama";
import repl from "node:repl";
import { setTimeout as sleep } from "timers/promises";
import { LlmSpansApi } from "@jbcbdse/charlie-datadog";
import dotenv from "dotenv";
import { DirectBirthdayTool } from "../tools/direct-birthday.tool";
import { DeleteAccountTool } from "../tools/delete-account.tool";
import {
  AvailableAgent,
  DEFAULT_AGENT,
  agentKeysByProvider,
  availableAgents,
  formatAgentsByProvider,
} from "../server/routes/agents";
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
  console.dir(data.messages, { depth: null });
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
const agents: Record<AvailableAgent, ChatAgent> = {
  "aws-bedrock/us.anthropic.claude-sonnet-4-6": new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.anthropic.claude-sonnet-4-6",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  "aws-bedrock/mistral.mistral-large-3-675b-instruct": new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "mistral.mistral-large-3-675b-instruct",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  "aws-bedrock/us.meta.llama4-scout-17b-instruct-v1:0": new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.meta.llama4-scout-17b-instruct-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  "aws-bedrock/us.meta.llama3-3-70b-instruct-v1:0": new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.meta.llama3-3-70b-instruct-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  "aws-bedrock/ai21.jamba-1-5-large-v1:0": new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "ai21.jamba-1-5-large-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  "aws-bedrock/us.amazon.nova-2-lite-v1:0": new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.amazon.nova-2-lite-v1:0",
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  "aws-bedrock/us.amazon.nova-micro-v1:0": new AiChatAgent({
    chatExecutor: new BedrockChatExecutor({
      modelId: "us.amazon.nova-micro-v1:0",
      toolsSupported: false,
    }),
    systemPromptTemplate: promptTemplate,
    preToolCallTransformers: [inlineToolCallParser, toolAssistantFilter],
    eventProducer: appEventProducer,
  }),
  "openai/gpt-5.6": new AiChatAgent({
    chatExecutor: new OpenAiChatExecutor({
      modelId: "gpt-5.6",
      apiKey: process.env.OPENAI_API_KEY!,
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "xAI/grok-4.3": new AiChatAgent({
    chatExecutor: new GrokExecutor({
      modelId: "grok-4.3",
      apiKey: process.env.XAI_API_KEY!,
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "google/gemini-2.5-flash": new AiChatAgent({
    chatExecutor: new GeminiExecutor({
      modelId: "gemini-2.5-flash",
      apiKey: process.env.GOOGLE_API_KEY!,
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "aws-bedrock-mantle/openai.gpt-oss-20b": new AiChatAgent({
    chatExecutor: new BedrockMantleExecutor({
      modelId: "openai.gpt-oss-20b",
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "aws-bedrock-mantle/deepseek.v3.2": new AiChatAgent({
    chatExecutor: new BedrockMantleExecutor({
      modelId: "deepseek.v3.2",
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "aws-bedrock-mantle/zai.glm-4.7-flash": new AiChatAgent({
    chatExecutor: new BedrockMantleExecutor({
      modelId: "zai.glm-4.7-flash",
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "aws-bedrock-mantle/xai.grok-4.3": new AiChatAgent({
    chatExecutor: new BedrockMantleExecutor({
      modelId: "xai.grok-4.3",
      // Grok on Mantle is served under /openai/v1, not /v1
      baseURL: `https://bedrock-mantle.${
        process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1"
      }.api.aws/openai/v1`,
    }),
    systemPromptTemplate: promptTemplate,
    eventProducer: appEventProducer,
  }),
  "ollama/qwen3.6:35b-a3b": new AiChatAgent({
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
let currentAgent: AvailableAgent = DEFAULT_AGENT;

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
        availableAgents: agentKeysByProvider,
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
  console.log(`The available agents are:\n${formatAgentsByProvider()}`);
  const r = repl.start({
    prompt: "> ",
    completer: (line: string): [string[], string] => {
      const prefix = "use ";
      if (!line.startsWith(prefix)) {
        return [[], line];
      }
      const rest = line.slice(prefix.length);
      const hits = availableAgents.filter((agent) => agent.startsWith(rest));
      return [hits.map((agent) => `${prefix}${agent}`), line];
    },
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
