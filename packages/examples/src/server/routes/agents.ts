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
  | "gemini";

export function agentsHandler(availableAgents: AvailableAgent[]) {
  return (_req: Request, res: Response) => {
    res.json({ agents: availableAgents });
  };
}
