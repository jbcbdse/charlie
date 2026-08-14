/* eslint-disable no-console */
import { startServer, stopServer } from "./helpers/server";
import { judge } from "./helpers/judge";
import { BASE_URL } from "./helpers/config";

jest.setTimeout(120_000);

interface ChatMessage {
  role: string;
  content?: string;
  toolCalls?: unknown[];
}

interface CapturedEvent {
  name: "tool:progress" | "log";
  message: string;
  level?: "error" | "warn" | "info" | "debug" | "verbose";
  meta?: Record<string, unknown>;
}

interface ChatResponse {
  response: string;
  agent: string;
  messages: ChatMessage[];
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  events?: CapturedEvent[];
}

async function chat(body: {
  message: string;
  agent?: string;
  messages?: ChatMessage[];
  user?: Record<string, string>;
}): Promise<{ status: number; data: ChatResponse }> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ChatResponse & { error?: string };
  if (res.status >= 500 && data.error) {
    throw new Error(`Server ${res.status}: ${data.error}`);
  }
  return { status: res.status, data };
}

async function assertJudge(response: string, criteria: string): Promise<void> {
  const result = await judge(response, criteria);
  if (!result.pass) {
    throw new Error(
      `LLM judge failed — ${result.reason}\n\nResponse was:\n${response}`,
    );
  }
}

beforeAll(async () => {
  await startServer();
}, 90_000);

afterAll(() => {
  stopServer();
});

// ---------------------------------------------------------------------------
// 1. Per-Module: Full Response + Judge
// ---------------------------------------------------------------------------
describe("Per-Module Response", () => {
  const CRITERIA = "The response is a greeting from an AI assistant";

  test("charlie-bedrock via claude", async () => {
    const { data } = await chat({
      message: "Say hello and tell me your name",
      agent: "claude",
    });
    await assertJudge(data.response, CRITERIA);
  });

  test("charlie-openai via gpt4o", async () => {
    const { data } = await chat({
      message: "Say hello and tell me your name",
      agent: "gpt4o",
    });
    await assertJudge(data.response, CRITERIA);
  });

  test("charlie-google via gemini", async () => {
    const { data } = await chat({
      message: "Say hello and tell me your name",
      agent: "gemini",
    });
    await assertJudge(data.response, CRITERIA);
  });

  test("charlie-openai via GrokExecutor (grok)", async () => {
    const { data } = await chat({
      message: "Say hello and tell me your name",
      agent: "grok",
    });
    await assertJudge(data.response, CRITERIA);
  });

  test("charlie-bedrock-mantle via mantle-gpt-oss", async () => {
    const { data } = await chat({
      message: "What is 2 plus 2? Reply briefly with the number.",
      agent: "mantle-gpt-oss",
    });
    await assertJudge(
      data.response,
      "The response indicates that the answer is 4",
    );
  });

  test("charlie-ollama via ollama", async () => {
    const { data } = await chat({
      message: "Say hello and tell me your name",
      agent: "ollama",
    });
    await assertJudge(data.response, CRITERIA);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// 3. Bedrock Model Smoke Tests (no judge — structural check only)
// ---------------------------------------------------------------------------
describe("Bedrock Model Smoke Tests", () => {
  test.each([
    ["claude", "baseline Bedrock model"],
    ["mistral", "Mistral tool call quirks"],
    ["commandr", "Llama4 Scout message format"],
    ["llama", "Llama inline tool parsing"],
    ["jamba-large", "AI21 Jamba format"],
    ["nova", "Amazon Nova"],
    ["titan", "toolsSupported=false + InlineToolCallParser"],
  ])("%s responds with non-empty output (%s)", async (agent) => {
    const { status, data } = await chat({
      message: "Reply with exactly the word PONG",
      agent,
    });
    expect(status).toBe(200);
    expect(typeof data.response).toBe("string");
    expect(data.response.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Tool Calling
// ---------------------------------------------------------------------------
describe("Tool Calling", () => {
  test("CalculatorTool — computes result and returns 105", async () => {
    const { data } = await chat({
      message: "What is 15 multiplied by 7?",
      agent: "claude",
    });
    expect(data.response).toContain("105");
  });

  test("CountLettersTool — counts 2 L's in hello", async () => {
    const { data } = await chat({
      message: "How many L's are in the word 'hello'?",
      agent: "claude",
    });
    expect(data.response).toMatch(/\b2\b/);
  });

  test("CountLettersTool — emits ToolProgress and Log events", async () => {
    const { data } = await chat({
      message: "How many L's are in the word 'hello'?",
      agent: "claude",
    });
    const events = data.events ?? [];
    const progress = events.filter((e) => e.name === "tool:progress");
    const logs = events.filter((e) => e.name === "log");

    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress.map((p) => p.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Scanning"),
        expect.stringContaining("Found"),
      ]),
    );

    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.map((l) => l.level)).toEqual(
      expect.arrayContaining(["info", "debug"]),
    );
    const finishedLog = logs.find((l) => l.message.includes("finished"));
    expect(finishedLog).toBeDefined();
    expect(finishedLog?.meta).toMatchObject({ word: "hello", letter: "l" });
  });

  test("CurrentTimeTool — returns a time value", async () => {
    const { data } = await chat({
      message: "What time is it right now?",
      agent: "claude",
    });
    await assertJudge(
      data.response,
      "The response mentions a specific time or date",
    );
  });

  test("DirectBirthdayTool — returnDirect stops the agent loop", async () => {
    const { data } = await chat({
      message: "Set my birthday to January 1st, 2000",
      agent: "claude",
    });
    // After the tool message with returnDirect=true, no further tool_call should appear
    const toolIdx = data.messages.map((m) => m.role).lastIndexOf("tool");
    const afterTool = data.messages.slice(toolIdx + 1);
    expect(afterTool.some((m) => m.role === "tool_call")).toBe(false);
    await assertJudge(
      data.response,
      "The response confirms a birthday was set",
    );
  });

  test("DeleteAccountTool — asks for confirmation when not certain", async () => {
    const { data } = await chat({
      message: "Please use the DeleteAccountTool to delete my account.",
      agent: "claude",
    });
    await assertJudge(
      data.response,
      "The response asks the user to confirm that they want to delete their account",
    );
  });

  test("DeleteAccountTool — deletes account after user confirms (multi-turn)", async () => {
    const turn1 = await chat({
      message: "Please use the DeleteAccountTool to delete my account.",
      agent: "claude",
    });
    const { data } = await chat({
      message: "Yes, I'm certain, please delete my account now",
      agent: "claude",
      messages: turn1.data.messages,
    });
    await assertJudge(
      data.response,
      "The response confirms the account has been deleted",
    );
  });

  test("CalculatorTool via Titan (InlineToolCallParser)", async () => {
    const { status, data } = await chat({
      message: "What is 15 multiplied by 7?",
      agent: "titan",
    });
    expect(status).toBe(200);
    expect(data.response).toContain("105");
  });
});

// ---------------------------------------------------------------------------
// 5. Message History Persistence
// ---------------------------------------------------------------------------
describe("Message History", () => {
  test("preserves context across turns", async () => {
    const turn1 = await chat({
      message: "My favorite color is ultraviolet",
      agent: "claude",
    });
    const { data } = await chat({
      message: "What is my favorite color?",
      agent: "claude",
      messages: turn1.data.messages,
    });
    await assertJudge(
      data.response,
      'The response mentions "ultraviolet" as the favorite color',
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Template System
// ---------------------------------------------------------------------------
describe("Template System", () => {
  test("user metadata is injected into system prompt", async () => {
    const { data } = await chat({
      message: "What is my preferred name?",
      agent: "claude",
      user: { preferred_name: "Zaphod" },
    });
    await assertJudge(
      data.response,
      'The response mentions "Zaphod" as the preferred name',
    );
  });
});
