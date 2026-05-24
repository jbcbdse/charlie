import { BASE_URL } from "./config";

export interface JudgeResult {
  pass: boolean;
  reason: string;
}

export async function judge(
  responseToEvaluate: string,
  criteria: string,
): Promise<JudgeResult> {
  const message = [
    "YOUR TASK: Evaluate a response against criteria.",
    "Return ONLY a JSON object — no explanation, no emoji, no surrounding text.",
    'Format: {"pass": true, "reason": "..."} or {"pass": false, "reason": "..."}',
    "",
    `Criteria: ${criteria}`,
    "",
    `Response to evaluate: ${responseToEvaluate}`,
  ].join("\n");

  try {
    const res = await fetch(`${BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, agent: "claude" }),
    });

    const data = (await res.json()) as { response: string };
    return parseJudgeResponse(data.response);
  } catch (err) {
    return { pass: false, reason: `Judge call failed: ${String(err)}` };
  }
}

function parseJudgeResponse(text: string): JudgeResult {
  // Try full JSON parse first
  try {
    const match = text.match(/\{[\s\S]*?"pass"[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as JudgeResult;
      if (typeof parsed.pass === "boolean") return parsed;
    }
  } catch {
    // fall through to regex extraction
  }

  // Fallback: extract pass/reason via regex
  const passMatch = text.match(/"pass"\s*:\s*(true|false)/);
  const reasonMatch = text.match(/"reason"\s*:\s*"([^"]+)"/);
  if (passMatch) {
    return {
      pass: passMatch[1] === "true",
      reason: reasonMatch?.[1] ?? text.slice(0, 200),
    };
  }

  return {
    pass: false,
    reason: `Could not parse judge response: ${text.slice(0, 200)}`,
  };
}
