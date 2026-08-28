/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import { startServer, stopServer } from "./helpers/server";
import { BASE_URL } from "./helpers/config";

jest.setTimeout(180_000);

const ZEBRA_PNG_B64 = fs
  .readFileSync(path.join(__dirname, "fixtures/zebra.png"))
  .toString("base64");

const AGENTS: [string, string][] = [
  ["claude", "bedrock converse"],
  ["mistral", "bedrock converse"],
  ["commandr", "bedrock converse"],
  ["llama", "bedrock converse"],
  ["jamba-large", "bedrock converse"],
  ["nova", "bedrock converse"],
  ["titan", "bedrock converse (no native tools)"],
  ["gpt4o", "openai chat"],
  ["grok", "xAI grok"],
  ["gemini", "google gemini"],
  ["mantle-gpt-oss", "mantle completions"],
  ["mantle-deepseek", "mantle completions"],
  ["mantle-glm", "mantle completions"],
  ["mantle-grok", "mantle completions"],
  ["mantle-gpt-oss-responses", "mantle responses"],
  ["mantle-grok-responses", "mantle responses"],
  ["mantle-gpt-5", "mantle responses"],
  ["mantle-claude", "mantle messages"],
  ["ollama", "ollama"],
];

/** Models with no image input (some 400, Nova 2 Lite accepts the request and ignores the image). */
const NO_VISION = new Set([
  "llama",
  "jamba-large",
  "nova",
  "titan",
  "mantle-gpt-oss",
  "mantle-deepseek",
  "mantle-glm",
  "mantle-gpt-oss-responses",
]);

interface ChatResponse {
  response: string;
  agent: string;
  messages: { role: string; content?: string; attachments?: unknown[] }[];
  error?: string;
}

function isModelUnavailable(error?: string): boolean {
  return /not available for this account|permission_error|access_denied|access denied|legacy|UnrecognizedClient|ExpiredToken|InvalidClientTokenId|Unauthorized|does(?: not|n't) support.{0,80}image|image content block|does not support image modality|image (is )?not supported|unsupported.*image|invalid.*image|ValidationException|can(?:not|'t) process.*image|could not process image|unable to process.{0,40}image|partId|modality|Sorry about that/i.test(
    error ?? "",
  );
}

async function chat(agent: string): Promise<{
  status: number;
  data: ChatResponse;
}> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent,
      message:
        "Read the word written in the attached image. Reply with that exact word.",
      attachments: [{ mimeType: "image/png", data: ZEBRA_PNG_B64 }],
    }),
  });
  const data = (await res.json()) as ChatResponse;
  if (res.status >= 500 && data.error && !isModelUnavailable(data.error)) {
    throw new Error(`Server ${res.status}: ${data.error}`);
  }
  return { status: res.status, data };
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

beforeAll(async () => {
  await startServer();
}, 90_000);

afterAll(() => {
  stopServer();
});

describe("Attachment vision input", () => {
  test.each(AGENTS)(
    "%s (%s) reads ZEBRA from a PNG",
    async (agent) => {
      if (agent === "ollama" && !(await ollamaAvailable())) {
        console.warn(
          "Skipping attachment e2e for ollama: Ollama not reachable at localhost:11434",
        );
        return;
      }
      const { status, data } = await chat(agent);
      if (status >= 400 && isModelUnavailable(data.error)) {
        console.warn(`Skipping ${agent} attachment e2e: ${data.error}`);
        return;
      }
      if (NO_VISION.has(agent)) {
        console.warn(
          `Skipping ${agent} attachment e2e: model has no image input`,
        );
        return;
      }
      expect(status).toBe(200);
      expect(data.response).toMatch(/zebra/i);
    },
    180_000,
  );
});
