/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable no-console */
import express from "express";
import {
  AiChatAgent,
  ChatAgent,
  EventProducer,
  EventSubscriber,
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
import { LlmSpansApi } from "@jbcbdse/charlie-datadog";
import dotenv from "dotenv";
import { DirectBirthdayTool } from "../tools/direct-birthday.tool";
import { DeleteAccountTool } from "../tools/delete-account.tool";
import { AvailableAgent, agentsHandler } from "./routes/agents";
import { chatHandler } from "./routes/chat";
dotenv.config({ path: "../../.env" });

const appEventProducer = new EventProducer();
const appEvents = new EventSubscriber(appEventProducer);

if (process.env.DD_API_KEY) {
  new LlmSpansApi({
    apiKey: process.env.DD_API_KEY!,
    tags: { service: "charlie", env: "dev" },
  }).listen(appEvents);
}

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
  "bedrock-mantle": new AiChatAgent({
    chatExecutor: new BedrockMantleExecutor(),
    systemPromptTemplate: promptTemplate,
  }),
};

const tools = [
  new CountLettersTool(),
  new CurrentTimeTool(),
  new CalculatorTool(),
  new DirectBirthdayTool(),
  new DeleteAccountTool(),
];

const availableAgents = Object.keys(agents) as AvailableAgent[];

const app = express();
app.use(express.json());

app.get("/agents", agentsHandler(availableAgents));
app.post("/chat", chatHandler(agents, availableAgents, tools, appEvents));

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`Charlie HTTP server running on http://localhost:${PORT}`);
  console.log(`Available agents: ${availableAgents.join(", ")}`);
});
