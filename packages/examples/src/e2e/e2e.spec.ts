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
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
  };
  events?: CapturedEvent[];
}

async function chat(body: {
  message: string;
  agent?: string;
  messages?: ChatMessage[];
  user?: Record<string, string>;
}): Promise<{ status: number; data: ChatResponse & { error?: string } }> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ChatResponse & { error?: string };
  if (res.status >= 500 && data.error && !isModelUnavailable(data.error)) {
    throw new Error(`Server ${res.status}: ${data.error}`);
  }
  return { status: res.status, data };
}

function isModelUnavailable(error?: string): boolean {
  return /not available for this account|permission_error|access_denied|access denied|legacy/i.test(
    error ?? "",
  );
}

function skipIfUnavailable(
  agent: string,
  status: number,
  error?: string,
): boolean {
  if (status >= 500 && isModelUnavailable(error)) {
    console.warn(`Skipping ${agent} e2e: ${error}`);
    return true;
  }
  return false;
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

  test("charlie-bedrock-mantle Responses API via mantle-gpt-oss-responses", async () => {
    const { data } = await chat({
      message: "What is 2 plus 2? Reply briefly with the number.",
      agent: "mantle-gpt-oss-responses",
    });
    await assertJudge(
      data.response,
      "The response indicates that the answer is 4",
    );
  });

  test("charlie-bedrock-mantle Responses API via mantle-grok-responses", async () => {
    const { data } = await chat({
      message: "What is 2 plus 2? Reply briefly with the number.",
      agent: "mantle-grok-responses",
    });
    await assertJudge(
      data.response,
      "The response indicates that the answer is 4",
    );
  });

  test("charlie-bedrock-mantle Responses API via mantle-gpt-5", async () => {
    const { status, data } = await chat({
      message: "What is 2 plus 2? Reply briefly with the number.",
      agent: "mantle-gpt-5",
    });
    if (skipIfUnavailable("mantle-gpt-5", status, data.error)) return;
    await assertJudge(
      data.response,
      "The response indicates that the answer is 4",
    );
  }, 180_000);

  test("charlie-bedrock-mantle Messages API via mantle-claude", async () => {
    const { status, data } = await chat({
      message: "What is 2 plus 2? Reply briefly with the number.",
      agent: "mantle-claude",
    });
    if (skipIfUnavailable("mantle-claude", status, data.error)) return;
    await assertJudge(
      data.response,
      "The response indicates that the answer is 4",
    );
  });

  test("charlie-ollama via ollama", async () => {
    try {
      const res = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) {
        console.warn(
          "Skipping charlie-ollama e2e: Ollama not reachable at localhost:11434",
        );
        return;
      }
    } catch {
      console.warn(
        "Skipping charlie-ollama e2e: Ollama not reachable at localhost:11434",
      );
      return;
    }
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
    if (skipIfUnavailable(agent, status, data.error)) return;
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

  test("CalculatorTool via mantle-gpt-oss-responses", async () => {
    const { data } = await chat({
      message: "What is 15 multiplied by 7?",
      agent: "mantle-gpt-oss-responses",
    });
    expect(data.response).toContain("105");
  });

  test("CalculatorTool via mantle-claude", async () => {
    const { status, data } = await chat({
      message: "What is 15 multiplied by 7?",
      agent: "mantle-claude",
    });
    if (skipIfUnavailable("mantle-claude", status, data.error)) return;
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

// ---------------------------------------------------------------------------
// 7. Streaming SSE
// ---------------------------------------------------------------------------
interface StreamChunk {
  type: "text" | "thinking" | "tool_call";
  text?: string;
}

interface SseEvent {
  event: string;
  data: unknown;
}

function parseSse(raw: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of raw.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!data) continue;
    events.push({ event, data: JSON.parse(data) });
  }
  return events;
}

function isUnreachable(status: number, error?: string): string | undefined {
  if (status === 401 || status === 403 || status === 404) {
    return `HTTP ${status}`;
  }
  if (
    error &&
    /401|403|404|Unauthorized|Forbidden|API[_ ]?key|ECONNREFUSED|not reachable|ENOTFOUND|Missing|Access denied|Legacy|reasoning_effort/i.test(
      error,
    )
  ) {
    return error;
  }
  return undefined;
}

async function chatStream(body: { message: string; agent: string }): Promise<{
  status: number;
  events: SseEvent[];
  done?: ChatResponse;
  error?: string;
}> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  const raw = await res.text();
  if (res.headers.get("content-type")?.includes("application/json")) {
    const parsed = JSON.parse(raw) as { error?: string };
    return { status: res.status, events: [], error: parsed.error };
  }
  const events = parseSse(raw);
  const doneEvent = events.find((e) => e.event === "done");
  const errorEvent = events.find((e) => e.event === "error");
  return {
    status: res.status,
    events,
    done: doneEvent?.data as ChatResponse | undefined,
    error:
      errorEvent && typeof errorEvent.data === "object" && errorEvent.data
        ? String((errorEvent.data as { error?: string }).error)
        : undefined,
  };
}

describe("Streaming SSE", () => {
  const agents: [string, string][] = [
    ["claude", "bedrock"],
    ["mistral", "bedrock"],
    ["commandr", "bedrock"],
    ["llama", "bedrock"],
    ["jamba-large", "bedrock"],
    ["nova", "bedrock"],
    ["titan", "bedrock"],
    ["gpt4o", "openai"],
    ["grok", "grok"],
    ["gemini", "gemini"],
    ["mantle-gpt-oss", "mantle"],
    ["mantle-deepseek", "mantle"],
    ["mantle-glm", "mantle"],
    ["mantle-grok", "mantle"],
    ["mantle-gpt-oss-responses", "mantle"],
    ["mantle-grok-responses", "mantle"],
    ["mantle-gpt-5", "mantle"],
    ["mantle-claude", "mantle"],
    ["ollama", "ollama"],
  ];

  test.each(agents)(
    "%s (%s) streams at least one chunk before done",
    async (agent) => {
      if (agent === "ollama") {
        try {
          const res = await fetch("http://localhost:11434/api/tags", {
            signal: AbortSignal.timeout(2000),
          });
          if (!res.ok) {
            console.warn(
              "Skipping stream e2e for ollama: Ollama not reachable at localhost:11434",
            );
            return;
          }
        } catch {
          console.warn(
            "Skipping stream e2e for ollama: Ollama not reachable at localhost:11434",
          );
          return;
        }
      }
      let result: Awaited<ReturnType<typeof chatStream>>;
      try {
        result = await chatStream({
          message: "Reply with exactly the word PONG",
          agent,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const skip = isUnreachable(0, reason);
        if (skip) {
          console.warn(`Skipping stream e2e for ${agent}: ${skip}`);
          return;
        }
        throw err;
      }
      const skip = isUnreachable(result.status, result.error);
      if (skip) {
        console.warn(`Skipping stream e2e for ${agent}: ${skip}`);
        return;
      }
      expect(result.status).toBe(200);
      expect(result.error).toBeUndefined();
      expect(result.done).toBeDefined();
      const chunkEvents = result.events.filter((e) => e.event === "chunk");
      const tokenChunks = chunkEvents
        .map((e) => e.data as StreamChunk)
        .filter((c) => c.type === "text" || c.type === "thinking");
      expect(tokenChunks.length).toBeGreaterThan(0);
      const concatenatedText = tokenChunks
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
      const assistantContent = (result.done?.messages ?? [])
        .filter((m) => m.role === "assistant")
        .map((m) => m.content ?? "")
        .join("");
      expect(concatenatedText).toBe(assistantContent);
      const thinkingText = tokenChunks
        .filter((c) => c.type === "thinking")
        .map((c) => c.text ?? "")
        .join("");
      if (thinkingText) {
        expect(assistantContent.includes(thinkingText)).toBe(false);
      }
    },
    180_000,
  );
});
