import { Request, Response } from "express";

export const agentsByProvider = {
  "aws-bedrock": [
    "us.anthropic.claude-sonnet-4-6",
    "mistral.mistral-large-3-675b-instruct",
    "us.meta.llama4-scout-17b-instruct-v1:0",
    "us.meta.llama3-3-70b-instruct-v1:0",
    "ai21.jamba-1-5-large-v1:0",
    "us.amazon.nova-2-lite-v1:0",
    "us.amazon.nova-micro-v1:0",
  ],
  openai: ["gpt-5.6"],
  xAI: ["grok-4.3"],
  google: ["gemini-2.5-flash"],
  "aws-bedrock-mantle": [
    "openai.gpt-oss-20b",
    "deepseek.v3.2",
    "zai.glm-4.7-flash",
    "xai.grok-4.3",
  ],
  ollama: ["qwen3.6:35b-a3b"],
} as const;

export type Provider = keyof typeof agentsByProvider;

export type AvailableAgent = {
  [P in Provider]: `${P}/${(typeof agentsByProvider)[P][number]}`;
}[Provider];

export const DEFAULT_AGENT =
  "aws-bedrock/us.anthropic.claude-sonnet-4-6" satisfies AvailableAgent;

export const agentKeysByProvider = Object.fromEntries(
  (Object.keys(agentsByProvider) as Provider[]).map((provider) => [
    provider,
    agentsByProvider[provider].map(
      (modelId) => `${provider}/${modelId}` as AvailableAgent,
    ),
  ]),
) as { [P in Provider]: AvailableAgent[] };

export const availableAgents = Object.values(
  agentKeysByProvider,
).flat() as AvailableAgent[];

export function formatAgentsByProvider(
  catalog: typeof agentKeysByProvider = agentKeysByProvider,
): string {
  return Object.entries(catalog)
    .map(([provider, keys]) => `  ${provider}: ${keys.join(", ")}`)
    .join("\n");
}

export function agentsHandler(
  catalog: typeof agentKeysByProvider = agentKeysByProvider,
) {
  return (_req: Request, res: Response) => {
    res.json({ agents: catalog });
  };
}
