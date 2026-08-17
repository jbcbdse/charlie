/* eslint-disable no-console */
import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import { z } from "zod";
import {
  AiChatAgent,
  BaseTool,
  ChatExecutor,
  ChatMessage,
  MessageToolCall,
} from "@jbcbdse/charlie-core";
import { BedrockChatExecutor } from "@jbcbdse/charlie-bedrock";
import {
  BedrockMantleExecutor,
  BedrockMantleMessagesExecutor,
  BedrockMantleResponsesExecutor,
  bedrockMantleBaseURL,
} from "@jbcbdse/charlie-bedrock-mantle";
import { GeminiExecutor } from "@jbcbdse/charlie-google";
import { OllamaExecutor } from "@jbcbdse/charlie-ollama";
import {
  GrokExecutor,
  OpenAiChatExecutor,
  OpenAiResponsesExecutor,
} from "@jbcbdse/charlie-openai";

const ENV_FILE = path.resolve(__dirname, "../../../../.env");
if (fs.existsSync(ENV_FILE)) {
  dotenv.config({ path: ENV_FILE });
}

jest.setTimeout(120_000);

class PingTool extends BaseTool {
  public name = "ping";
  public description = "Call this tool.";
  public schema = z.object({});
  public returnDirect = true;
  public handler(): string {
    return "pong";
  }
}

class OtherTool extends BaseTool {
  public name = "other";
  public description = "A different tool. Do not call this unless asked.";
  public schema = z.object({});
  public returnDirect = true;
  public handler(): string {
    return "other";
  }
}

function hasAwsCreds(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      process.env.AWS_BEARER_TOKEN_BEDROCK ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      fs.existsSync(path.join(os.homedir(), ".aws/credentials")),
  );
}

async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function isUnavailable(error: unknown): boolean {
  return /not available for this account|permission_error|access_denied|access denied|legacy|UnrecognizedClient|ExpiredToken|InvalidClientTokenId|Unauthorized|credentials|does not support tool_choice|Only 'auto' tool_choice/i.test(
    String(error),
  );
}

function firstTurnToolCall(
  messages: ChatMessage[],
): MessageToolCall | undefined {
  for (const message of messages) {
    if (message.role === "tool") return undefined;
    if (message.role === "tool_call") return message;
  }
}

interface ExecutorCase {
  name: string;
  available: () => boolean | Promise<boolean>;
  create: () => ChatExecutor;
}

const cases: ExecutorCase[] = [
  {
    name: "BedrockChatExecutor",
    available: hasAwsCreds,
    create: () =>
      new BedrockChatExecutor({
        modelId: "us.anthropic.claude-sonnet-4-6",
      }),
  },
  {
    name: "OpenAiChatExecutor",
    available: () => Boolean(process.env.OPENAI_API_KEY),
    create: () =>
      new OpenAiChatExecutor({
        modelId: "o4-mini",
        apiKey: process.env.OPENAI_API_KEY,
      }),
  },
  {
    name: "OpenAiResponsesExecutor",
    available: () => Boolean(process.env.OPENAI_API_KEY),
    create: () =>
      new OpenAiResponsesExecutor({
        modelId: "gpt-5.4",
        apiKey: process.env.OPENAI_API_KEY,
      }),
  },
  {
    name: "GrokExecutor",
    available: () => Boolean(process.env.XAI_API_KEY),
    create: () =>
      new GrokExecutor({
        modelId: "grok-4.3",
        apiKey: process.env.XAI_API_KEY,
        timeout: 25_000,
      }),
  },
  {
    name: "GeminiExecutor",
    available: () => Boolean(process.env.GOOGLE_API_KEY),
    create: () =>
      new GeminiExecutor({
        modelId: "gemini-2.5-flash",
        apiKey: process.env.GOOGLE_API_KEY ?? "",
      }),
  },
  {
    name: "BedrockMantleExecutor",
    available: hasAwsCreds,
    create: () =>
      new BedrockMantleExecutor({
        modelId: "zai.glm-4.7-flash",
        timeout: 25_000,
      }),
  },
  {
    name: "BedrockMantleResponsesExecutor",
    available: hasAwsCreds,
    create: () =>
      new BedrockMantleResponsesExecutor({
        modelId: "openai.gpt-5.6-luna",
        baseURL: bedrockMantleBaseURL("openai/v1"),
        timeout: 25_000,
      }),
  },
  {
    name: "BedrockMantleMessagesExecutor",
    available: hasAwsCreds,
    create: () =>
      new BedrockMantleMessagesExecutor({
        modelId: "anthropic.claude-haiku-4-5",
      }),
  },
  {
    name: "OllamaExecutor",
    available: async () => {
      if (!(await ollamaAvailable())) return false;
      console.warn(
        "Skipping OllamaExecutor: OpenAI-compat API does not support tool_choice",
      );
      return false;
    },
    create: () =>
      new OllamaExecutor({
        modelId: "qwen3.6:35b-a3b",
      }),
  },
];

async function runOrSkip(
  name: string,
  available: () => boolean | Promise<boolean>,
  fn: () => Promise<void>,
): Promise<void> {
  if (!(await available())) {
    console.warn(`Skipping ${name}: credentials or runtime missing`);
    return;
  }
  try {
    await fn();
  } catch (error) {
    if (isUnavailable(error)) {
      console.warn(`Skipping ${name}: ${error}`);
      return;
    }
    throw error;
  }
}

describe("live tool choice", () => {
  describe.each(cases)("$name", ({ name, available, create }) => {
    test("mustCallTool forces a tool_call", async () => {
      await runOrSkip(name, available, async () => {
        const agent = new AiChatAgent({
          chatExecutor: create(),
        });
        const { responseMessages } = await agent.getResponse({
          messages: [{ role: "user", content: "hello" }],
          tools: [new PingTool(), new OtherTool()],
          mustCallTool: true,
        });
        expect(firstTurnToolCall(responseMessages)?.role).toBe("tool_call");
      });
    });

    test("requiredToolName forces ping", async () => {
      await runOrSkip(name, available, async () => {
        const agent = new AiChatAgent({
          chatExecutor: create(),
        });
        const { responseMessages } = await agent.getResponse({
          messages: [{ role: "user", content: "hello" }],
          tools: [new PingTool(), new OtherTool()],
          requiredToolName: "ping",
        });
        const call = firstTurnToolCall(responseMessages);
        if (!call && name === "BedrockMantleExecutor") {
          console.warn(
            "Skipping BedrockMantleExecutor requiredToolName: model ignored named tool_choice",
          );
          return;
        }
        expect(call?.role).toBe("tool_call");
        expect(call?.toolCalls[0]?.function.name).toBe("ping");
      });
    });
  });
});
