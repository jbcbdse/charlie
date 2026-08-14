import { Request, Response } from "express";

export type AvailableAgent =
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
  | "ollama";

export function agentsHandler(availableAgents: AvailableAgent[]) {
  return (_req: Request, res: Response) => {
    res.json({ agents: availableAgents });
  };
}
